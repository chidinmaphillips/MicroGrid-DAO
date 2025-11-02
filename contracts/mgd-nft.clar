;; contracts/mgd-nft.clar
(define-non-fungible-token microgrid-nft uint)

(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-NOT-OWNER u101)
(define-constant ERR-ALREADY-MINTED u102)
(define-constant ERR-GRID-NOT-REGISTERED u103)
(define-constant ERR-INVALID-METADATA u104)
(define-constant ERR-LOCKED u105)
(define-constant ERR-NOT-LOCKED u106)
(define-constant ERR-INVALID-LEVEL u107)

(define-data-var last-token-id uint u0)
(define-data-var contract-owner principal tx-sender)
(define-data-var metadata-frozen bool false)

(define-map token-metadata uint
  { name: (string-ascii 64),
    location: (string-ascii 80),
    capacity-kw: uint,
    level: uint,
    locked: bool,
    locked-until: uint,
    ipfs-hash: (string-ascii 46) })

(define-map grid-to-token uint uint)

(define-read-only (get-owner (token-id uint))
  (nft-get-owner? microgrid-nft token-id))

(define-read-only (get-metadata (token-id uint))
  (map-get? token-metadata token-id))

(define-read-only (get-token-by-grid (grid-id uint))
  (map-get? grid-to-token grid-id))

(define-read-only (is-locked (token-id uint))
  (match (map-get? token-metadata token-id)
    data (get locked data)
    false))

(define-public (mint-nft
    (grid-id uint)
    (name (string-ascii 64))
    (location (string-ascii 80))
    (capacity-kw uint)
    (ipfs-hash (string-ascii 46)))
  (let ((token-id (+ (var-get last-token-id) u1)))
    (asserts! (is-eq tx-sender contract-owner) (err ERR-UNAUTHORIZED))
    (asserts! (is-none (map-get? grid-to-token grid-id)) (err ERR-ALREADY-MINTED))
    (asserts! (is-some (contract-call? .microgrid-dao get-grid grid-id)) (err ERR-GRID-NOT-REGISTERED))
    (asserts! (and (>= (len ipfs-hash) u46) (is-eq (len ipfs-hash) u46)) (err ERR-INVALID-METADATA))
    (try! (nft-mint? microgrid-nft token-id tx-sender))
    (map-set token-metadata token-id
      { name: name,
        location: location,
        capacity-kw: capacity-kw,
        level: u1,
        locked: false,
        locked-until: u0,
        ipfs-hash: ipfs-hash })
    (map-set grid-to-token grid-id token-id)
    (var-set last-token-id token-id)
    (print { event: "nft-minted", token-id: token-id, grid-id: grid-id })
    (ok token-id)))

(define-public (transfer (token-id uint) (recipient principal))
  (let ((metadata (unwrap! (map-get? token-metadata token-id) (err ERR-NOT-OWNER))))
    (asserts! (is-eq (nft-get-owner? microgrid-nft token-id) (some tx-sender)) (err ERR-NOT-OWNER))
    (asserts! (not (get locked metadata)) (err ERR-LOCKED))
    (try! (nft-transfer? microgrid-nft token-id tx-sender recipient))
    (ok true)))

(define-public (lock-nft (token-id uint) (blocks uint))
  (let ((metadata (unwrap! (map-get? token-metadata token-id) (err ERR-NOT-OWNER)))
        (owner (unwrap! (nft-get-owner? microgrid-nft token-id) (err ERR-NOT-OWNER))))
    (asserts! (is-eq tx-sender owner) (err ERR-NOT-OWNER))
    (asserts! (not (get locked metadata)) (err ERR-LOCKED))
    (map-set token-metadata token-id
      (merge metadata { locked: true, locked-until: (+ block-height blocks) }))
    (ok true)))

(define-public (unlock-nft (token-id uint))
  (let ((metadata (unwrap! (map-get? token-metadata token-id) (err ERR-NOT-OWNER)))
        (owner (unwrap! (nft-get-owner? microgrid-nft token-id) (err ERR-NOT-OWNER))))
    (asserts! (is-eq tx-sender owner) (err ERR-NOT-OWNER))
    (asserts! (get locked metadata) (err ERR-NOT-LOCKED))
    (asserts! (>= block-height (get locked-until metadata)) (err ERR-LOCKED))
    (map-set token-metadata token-id
      (merge metadata { locked: false, locked-until: u0 }))
    (ok true)))

(define-public (upgrade-level (token-id uint))
  (let ((metadata (unwrap! (map-get? token-metadata token-id) (err ERR-NOT-OWNER)))
        (owner (unwrap! (nft-get-owner? microgrid-nft token-id) (err ERR-NOT-OWNER))))
    (asserts! (is-eq tx-sender owner) (err ERR-NOT-OWNER))
    (asserts! (< (get level metadata) u10) (err ERR-INVALID-LEVEL))
    (map-set token-metadata token-id
      (merge metadata { level: (+ (get level metadata) u1) }))
    (ok (get level metadata))))

(define-public (freeze-metadata)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (var-set metadata-frozen true)
    (ok true)))