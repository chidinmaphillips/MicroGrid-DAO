// tests/mgd-nft.test.ts
import { describe, it, expect, beforeEach } from "vitest";

const ERR_UNAUTHORIZED = 100;
const ERR_NOT_OWNER = 101;
const ERR_ALREADY_MINTED = 102;
const ERR_GRID_NOT_REGISTERED = 103;
const ERR_INVALID_METADATA = 104;
const ERR_LOCKED = 105;
const ERR_NOT_LOCKED = 106;
const ERR_INVALID_LEVEL = 107;

interface NFTMetadata {
  name: string;
  location: string;
  "capacity-kw": bigint;
  level: bigint;
  locked: boolean;
  "locked-until": bigint;
  "ipfs-hash": string;
}

class MGDNFTMock {
  state = {
    lastTokenId: 0n,
    owner: "STOWNER",
    frozen: false,
    tokens: new Map<bigint, string>(),
    metadata: new Map<bigint, NFTMetadata>(),
    gridToToken: new Map<bigint, bigint>(),
  };
  blockHeight = 10_000n;
  caller = "STOWNER";
  daoGrids = new Map<bigint, boolean>([
    [1n, true],
    [2n, true],
    [3n, true],
  ]);

  reset() {
    this.state = {
      lastTokenId: 0n,
      owner: "STOWNER",
      frozen: false,
      tokens: new Map(),
      metadata: new Map(),
      gridToToken: new Map(),
    };
    this.blockHeight = 10_000n;
    this.caller = "STOWNER";
  }

  mintNFT(
    gridId: bigint,
    name: string,
    location: string,
    capacity: bigint,
    ipfs: string
  ) {
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_UNAUTHORIZED };
    if (!this.daoGrids.has(gridId))
      return { ok: false, value: ERR_GRID_NOT_REGISTERED };
    if (this.state.gridToToken.has(gridId))
      return { ok: false, value: ERR_ALREADY_MINTED };
    if (ipfs.length !== 46) return { ok: false, value: ERR_INVALID_METADATA };
    const id = this.state.lastTokenId + 1n;
    this.state.tokens.set(id, this.caller);
    this.state.metadata.set(id, {
      name,
      location,
      "capacity-kw": capacity,
      level: 1n,
      locked: false,
      "locked-until": 0n,
      "ipfs-hash": ipfs,
    });
    this.state.gridToToken.set(gridId, id);
    this.state.lastTokenId = id;
    return { ok: true, value: id };
  }

  transfer(tokenId: bigint, to: string) {
    const owner = this.state.tokens.get(tokenId);
    if (!owner) return { ok: false, value: ERR_NOT_OWNER };
    if (owner !== this.caller) return { ok: false, value: ERR_NOT_OWNER };
    const meta = this.state.metadata.get(tokenId)!;
    if (meta.locked) return { ok: false, value: ERR_LOCKED };
    this.state.tokens.set(tokenId, to);
    return { ok: true, value: true };
  }

  lockNFT(tokenId: bigint, blocks: bigint) {
    const owner = this.state.tokens.get(tokenId);
    if (!owner || owner !== this.caller)
      return { ok: false, value: ERR_NOT_OWNER };
    const meta = this.state.metadata.get(tokenId)!;
    if (meta.locked) return { ok: false, value: ERR_LOCKED };
    this.state.metadata.set(tokenId, {
      ...meta,
      locked: true,
      "locked-until": this.blockHeight + blocks,
    });
    return { ok: true, value: true };
  }

  unlockNFT(tokenId: bigint) {
    const owner = this.state.tokens.get(tokenId);
    if (!owner || owner !== this.caller)
      return { ok: false, value: ERR_NOT_OWNER };
    const meta = this.state.metadata.get(tokenId)!;
    if (!meta.locked) return { ok: false, value: ERR_NOT_LOCKED };
    if (this.blockHeight < meta["locked-until"])
      return { ok: false, value: ERR_LOCKED };
    this.state.metadata.set(tokenId, {
      ...meta,
      locked: false,
      "locked-until": 0n,
    });
    return { ok: true, value: true };
  }

  upgradeLevel(tokenId: bigint) {
    const owner = this.state.tokens.get(tokenId);
    if (!owner || owner !== this.caller)
      return { ok: false, value: ERR_NOT_OWNER };
    const meta = this.state.metadata.get(tokenId)!;
    if (meta.level >= 10n) return { ok: false, value: ERR_INVALID_LEVEL };
    const newLevel = meta.level + 1n;
    this.state.metadata.set(tokenId, { ...meta, level: newLevel });
    return { ok: true, value: newLevel };
  }

  freezeMetadata() {
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.frozen = true;
    return { ok: true, value: true };
  }

  getMetadata(tokenId: bigint) {
    return this.state.metadata.get(tokenId) || null;
  }

  getTokenByGrid(gridId: bigint) {
    return this.state.gridToToken.get(gridId) || null;
  }

  getOwner(tokenId: bigint) {
    return this.state.tokens.get(tokenId) || null;
  }
}

describe("MGD-NFT Tests", () => {
  let nft: MGDNFTMock;

  beforeEach(() => {
    nft = new MGDNFTMock();
    nft.reset();
  });

  it("mints valid NFT with exact 46-char IPFS CID", () => {
    const ipfs = "QmRAQB6MaYq4N3e1bRxu2C3z4D5e6F7g8H9iJ1k2L3m4N5";
    const res = nft.mintNFT(1n, "Solar Alpha", "Nairobi", 750n, ipfs);
    expect(res).toEqual({ ok: true, value: 1n });
    expect(nft.getMetadata(1n)?.name).toBe("Solar Alpha");
    expect(nft.getMetadata(1n)?.["ipfs-hash"]).toBe(ipfs);
    expect(nft.getTokenByGrid(1n)).toBe(1n);
  });

  it("rejects non-46-char IPFS hashes", () => {
    expect(nft.mintNFT(1n, "A", "B", 10n, "short").value).toBe(
      ERR_INVALID_METADATA
    );
    expect(
      nft.mintNFT(
        1n,
        "A",
        "B",
        10n,
        "Qmt00longtobevalidbutstillwronglength123456"
      ).value
    ).toBe(ERR_INVALID_METADATA);
  });

  it("only contract owner can mint", () => {
    nft.caller = "STHACKER";
    const res = nft.mintNFT(
      2n,
      "Hack",
      "Loc",
      50n,
      "QmAbcdefghijklmnopqrstuvwxyz1234567890abcd"
    );
    expect(res).toEqual({ ok: false, value: ERR_UNAUTHORIZED });
  });

  it("only owner can transfer unlocked NFT", () => {
    nft.mintNFT(
      1n,
      "A",
      "B",
      100n,
      "QmAbcdefghijklmnopqrstuvwxyz1234567890abcd"
    );
    nft.caller = "STTHIEF";
    const res = nft.transfer(1n, "STTHIEF");
    expect(res).toEqual({ ok: false, value: ERR_NOT_OWNER });
  });

  it("non-owner cannot upgrade", () => {
    nft.mintNFT(
      1n,
      "A",
      "B",
      100n,
      "QmAbcdefghijklmnopqrstuvwxyz1234567890abcd"
    );
    nft.caller = "STFAKE";
    expect(nft.upgradeLevel(1n)).toEqual({ ok: false, value: ERR_NOT_OWNER });
  });

  it("metadata freeze is irreversible", () => {
    nft.freezeMetadata();
    expect(nft.state.frozen).toBe(true);
    nft.caller = "STHACKER";
    expect(nft.freezeMetadata()).toEqual({
      ok: false,
      value: ERR_UNAUTHORIZED,
    });
  });

  it("rejects mint on unregistered grid", () => {
    const res = nft.mintNFT(
      99n,
      "Ghost",
      "Loc",
      100n,
      "QmAbcdefghijklmnopqrstuvwxyz1234567890abcd"
    );
    expect(res).toEqual({ ok: false, value: ERR_GRID_NOT_REGISTERED });
  });

  it("returns null for nonexistent token", () => {
    expect(nft.getMetadata(999n)).toBeNull();
    expect(nft.getOwner(999n)).toBeNull();
  });
});
