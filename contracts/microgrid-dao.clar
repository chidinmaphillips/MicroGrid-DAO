(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-NOT-FOUND u101)
(define-constant ERR-ALREADY-EXISTS u102)
(define-constant ERR-INVALID-AMOUNT u103)
(define-constant ERR-PROPOSAL-CLOSED u104)
(define-constant ERR-ALREADY-VOTED u105)
(define-constant ERR-INSUFFICIENT-BALANCE u106)
(define-constant ERR-VOTING-ENDED u107)
(define-constant ERR-EXECUTION-FAILED u108)
(define-constant ERR-INVALID-LOCATION u109)
(define-constant ERR-INVALID-CAPACITY u110)
(define-constant ERR-INVALID-ENERGY u111)
(define-constant ERR-ORACLE-NOT-SET u112)
(define-constant ERR-TIMESTAMP-PAST u113)
(define-constant ERR-QUORUM-NOT-MET u114)

(define-data-var next-grid-id uint u0)
(define-data-var next-proposal-id uint u0)
(define-data-var dao-oracle (optional principal) none)
(define-data-var quorum-threshold uint u66)
(define-data-var voting-duration uint u2880)
(define-data-var execution-delay uint u144)

(define-map microgrids uint
  { owner: principal,
    location: (string-ascii 80),
    capacity-kw: uint,
    active: bool,
    registered-at: uint })

(define-map energy-readings { grid-id: uint, timestamp: uint } uint)

(define-map proposals uint
  { grid-id: uint,
    title: (string-ascii 120),
    description: (string-ascii 500),
    amount-stx: uint,
    proposer: principal,
    start-height: uint,
    end-height: uint,
    executed: bool,
    yes-votes: uint,
    no-votes: uint,
    total-voted: uint })

(define-map votes { proposal-id: uint, voter: principal } { yes: bool, weight: uint })

(define-map treasury-balances principal uint)

(define-read-only (get-grid (id uint))
  (map-get? microgrids id))

(define-read-only (get-proposal (id uint))
  (map-get? proposals id))

(define-read-only (get-vote (proposal-id uint) (voter principal))
  (map-get? votes { proposal-id: proposal-id, voter: voter }))

(define-read-only (get-energy-reading (grid-id uint) (timestamp uint))
  (map-get? energy-readings { grid-id: grid-id, timestamp: timestamp }))

(define-read-only (get-treasury-balance (who principal))
  (default-to u0 (map-get? treasury-balances who)))

(define-private (validate-location (loc (string-ascii 80)))
  (and (> (len loc) u4) (<= (len loc) u80)))

(define-private (validate-capacity (kw uint))
  (>= kw u10))

(define-private (validate-amount (amount uint))
  (> amount u0))

(define-private (is-oracle)
  (match (var-get dao-oracle)
    oracle (is-eq oracle tx-sender)
    false))

(define-public (set-oracle (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) (err ERR-UNAUTHORIZED))
    (var-set dao-oracle (some new-oracle))
    (ok true)))

(define-public (register-microgrid (location (string-ascii 80)) (capacity-kw uint))
  (let ((grid-id (+ (var-get next-grid-id) u1)))
    (asserts! (validate-location location) (err ERR-INVALID-LOCATION))
    (asserts! (validate-capacity capacity-kw) (err ERR-INVALID-CAPACITY))
    (map-insert microgrids grid-id
      { owner: tx-sender,
        location: location,
        capacity-kw: capacity-kw,
        active: true,
        registered-at: block-height })
    (var-set next-grid-id grid-id)
    (print { event: "grid-registered", id: grid-id, owner: tx-sender })
    (ok grid-id)))

(define-public (deposit-treasury (amount uint))
  (let ((sender tx-sender))
    (asserts! (validate-amount amount) (err ERR-INVALID-AMOUNT))
    (try! (stx-transfer? amount sender (as-contract tx-sender)))
    (map-set treasury-balances sender
      (+ (get-treasury-balance sender) amount))
    (print { event: "treasury-deposit", sender: sender, amount: amount })
    (ok amount)))

(define-public (create-proposal (grid-id uint) (title (string-ascii 120)) (description (string-ascii 500)) (amount-stx uint))
  (let ((prop-id (+ (var-get next-proposal-id) u1))
        (start-height block-height)
        (end-height (+ block-height (var-get voting-duration))))
    (asserts! (is-some (map-get? microgrids grid-id)) (err ERR-NOT-FOUND))
    (asserts! (validate-amount amount-stx) (err ERR-INVALID-AMOUNT))
    (asserts! (>= (get-treasury-balance tx-sender) amount-stx) (err ERR-INSUFFICIENT-BALANCE))
    (map-insert proposals prop-id
      { grid-id: grid-id,
        title: title,
        description: description,
        amount-stx: amount-stx,
        proposer: tx-sender,
        start-height: start-height,
        end-height: end-height,
        executed: false,
        yes-votes: u0,
        no-votes: u0,
        total-voted: u0 })
    (var-set next-proposal-id prop-id)
    (print { event: "proposal-created", id: prop-id, grid-id: grid-id })
    (ok prop-id)))

(define-public (vote-proposal (proposal-id uint) (yes bool) (weight uint))
  (let ((prop (unwrap! (map-get? proposals proposal-id) (err ERR-NOT-FOUND)))
        (voter tx-sender)
        (existing (map-get? votes { proposal-id: proposal-id, voter: voter })))
    (asserts! (< block-height (get end-height prop)) (err ERR-VOTING-ENDED))
    (asserts! (is-none existing) (err ERR-ALREADY-VOTED))
    (asserts! (>= (get-treasury-balance voter) weight) (err ERR-INSUFFICIENT-BALANCE))
    (asserts! (> weight u0) (err ERR-INVALID-AMOUNT))
    (map-set votes { proposal-id: proposal-id, voter: voter }
      { yes: yes, weight: weight })
    (map-set proposals proposal-id
      (merge prop
        (if yes
          { yes-votes: (+ (get yes-votes prop) weight),
            total-voted: (+ (get total-voted prop) weight) }
          { no-votes: (+ (get no-votes prop) weight),
            total-voted: (+ (get total-voted prop) weight) })))
    (print { event: "vote-cast", proposal-id: proposal-id, voter: voter, yes: yes, weight: weight })
    (ok true)))

(define-public (execute-proposal (proposal-id uint))
  (let ((prop (unwrap! (map-get? proposals proposal-id) (err ERR-NOT-FOUND)))
        (grid (unwrap! (map-get? microgrids (get grid-id prop)) (err ERR-NOT-FOUND))))
    (asserts! (not (get executed prop)) (err ERR-PROPOSAL-CLOSED))
    (asserts! (>= block-height (+ (get end-height prop) (var-get execution-delay))) (err ERR-VOTING-ENDED))
    (let ((yes (get yes-votes prop))
          (total (get total-voted prop))
          (quorum-met (>= (* total u100) (* yes (var-get quorum-threshold)))))
      (asserts! quorum-met (err ERR-QUORUM-NOT-MET))
      (try! (as-contract (stx-transfer? (get amount-stx prop) tx-sender (get owner grid))))
      (map-set proposals proposal-id (merge prop { executed: true }))
      (print { event: "proposal-executed", id: proposal-id, amount: (get amount-stx prop) })
      (ok true))))

(define-public (submit-energy-reading (grid-id uint) (timestamp uint) (kwh uint))
  (begin
    (asserts! (is-oracle) (err ERR-UNAUTHORIZED))
    (asserts! (>= timestamp block-height) (err ERR-TIMESTAMP-PAST))
    (asserts! (> kwh u0) (err ERR-INVALID-ENERGY))
    (map-insert energy-readings { grid-id: grid-id, timestamp: timestamp } kwh)
    (print { event: "energy-submitted", grid-id: grid-id, kwh: kwh, timestamp: timestamp })
    (ok true)))

(define-public (withdraw-treasury (amount uint))
  (let ((sender tx-sender)
        (balance (get-treasury-balance sender)))
    (asserts! (validate-amount amount) (err ERR-INVALID-AMOUNT))
    (asserts! (>= balance amount) (err ERR-INSUFFICIENT-BALANCE))
    (map-set treasury-balances sender (- balance amount))
    (try! (as-contract (stx-transfer? amount tx-sender sender)))
    (ok true)))