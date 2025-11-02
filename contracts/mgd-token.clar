;; contracts/mgd-token.clar
(define-fungible-token mgd u1000000000000)

(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-NOT-OWNER u101)
(define-constant ERR-ALREADY-INITIALIZED u102)
(define-constant ERR-ZERO-AMOUNT u103)
(define-constant ERR-INSUFFICIENT-BALANCE u104)
(define-constant ERR-PAUSED u105)
(define-constant ERR-NOT-PAUSED u106)
(define-constant ERR-SNAPSHOT-EXISTS u107)
(define-constant ERR-INVALID-SNAPSHOT u108)

(define-data-var token-name (string-ascii 32) "MicroGrid DAO Token")
(define-data-var token-symbol (string-ascii 10) "MGD")
(define-data-var token-uri (optional (string-utf8 256)) none)
(define-data-var decimals uint u6)
(define-data-var contract-owner principal tx-sender)
(define-data-var initialized bool false)
(define-data-var paused bool false)

(define-map snapshots uint { total-supply: uint, block-height: uint })
(define-data-var last-snapshot-id uint u0)

(define-map delegates principal { delegate: principal, expires-at: (optional uint) })
(define-map voting-power-checkpoints principal (list 200 { from-block: uint, power: uint }))

(define-read-only (get-name) (var-get token-name))
(define-read-only (get-symbol) (var-get token-symbol))
(define-read-only (get-decimals) (var-get decimals))
(define-read-only (get-total-supply) (ft-get-supply mgd))
(define-read-only (get-balance (account principal)) (ft-get-balance mgd account))
(define-read-only (get-token-uri) (var-get token-uri))
(define-read-only (is-paused) (var-get paused))
(define-read-only (get-owner) (var-get contract-owner))

(define-read-only (get-snapshot (id uint))
  (map-get? snapshots id))

(define-read-only (get-delegate (delegator principal))
  (get delegate (map-get? delegates delegator)))

(define-read-only (get-voting-power-at (account principal) (block uint))
  (let ((checkpoints (default-to (list) (map-get? voting-power-checkpoints account))))
    (fold find-power checkpoints { account: account, target: block, last-power: u0 })))

(define-private (find-power (checkpoint { from-block: uint, power: uint })
                           (ctx { account: principal, target: uint, last-power: uint }))
  (let ((from (get from-block checkpoint))
        (power (get power checkpoint)))
    (if (and (<= from (get target ctx)) (> power (get last-power ctx)))
        (merge ctx { last-power: power })
        ctx)))

(define-public (initialize (name (string-ascii 32)) (symbol (string-ascii 10)) (decimals-val uint) (uri (optional (string-utf8 256))))
  (begin
    (asserts! (not (var-get initialized)) (err ERR-ALREADY-INITIALIZED))
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (var-set token-name name)
    (var-set token-symbol symbol)
    (var-set decimals decimals-val)
    (var-set token-uri uri)
    (var-set initialized true)
    (try! (mint u500000000000 tx-sender))
    (ok true)))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (> amount u0) (err ERR-ZERO-AMOUNT))
    (try! (ft-transfer? mgd amount sender recipient))
    (match memo data (print { event: "transfer-memo", memo: data }) (ok true))
    (ok true)))

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (asserts! (> amount u0) (err ERR-ZERO-AMOUNT))
    (ft-mint? mgd amount recipient)))

(define-public (burn (amount uint) (sender principal))
  (begin
    (asserts! (> amount u0) (err ERR-ZERO-AMOUNT))
    (ft-burn? mgd amount sender)))

(define-public (pause)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (var-set paused true)
    (ok true)))

(define-public (unpause)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (asserts! (var-get paused) (err ERR-NOT-PAUSED))
    (var-set paused false)
    (ok true)))

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (var-set contract-owner new-owner)
    (ok true)))

(define-public (create-snapshot)
  (let ((snapshot-id (+ (var-get last-snapshot-id) u1))
        (supply (ft-get-supply mgd)))
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (map-set snapshots snapshot-id { total-supply: supply, block-height: block-height })
    (var-set last-snapshot-id snapshot-id)
    (ok snapshot-id)))

(define-public (delegate-voting-power (delegate-to principal) (expires-at (optional uint)))
  (begin
    (asserts! (not (is-eq delegate-to tx-sender)) (err ERR-NOT-OWNER))
    (map-set delegates tx-sender { delegate: delegate-to, expires-at: expires-at })
    (ok true)))

(define-public (vote-with-delegated-power (proposal-id uint) (yes bool))
  (let ((power (get-current-voting-power tx-sender)))
    (asserts! (> power u0) (err ERR-INSUFFICIENT-BALANCE))
    (try! (contract-call? .microgrid-dao vote-proposal proposal-id yes power))
    (ok power)))

(define-private (get-current-voting-power (account principal))
  (let ((balance (get-balance account))
        (delegate-entry (map-get? delegates account)))
    (match delegate-entry
      entry (if (match (get expires-at entry)
                  expires (>= block-height expires)
                  true)
                u0
                balance)
      balance)))

(define-public (checkpoint-power (account principal))
  (let ((current-power (get-current-voting-power account))
        (checkpoints (default-to (list) (map-get? voting-power-checkpoints account))))
    (map-set voting-power-checkpoints account
      (unwrap! (as-max-len? (append checkpoints { from-block: block-height, power: current-power }) u200) 
               checkpoints))
    (ok true)))