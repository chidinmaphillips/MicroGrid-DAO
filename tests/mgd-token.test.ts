// tests/mgd-token.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_ALREADY_INITIALIZED = 102;
const ERR_ZERO_AMOUNT = 103;
const ERR_PAUSED = 105;

interface Snapshot {
  "total-supply": bigint;
  "block-height": bigint;
}

interface Delegate {
  delegate: string;
  "expires-at": bigint | null;
}

class MGDTokenMock {
  state = {
    name: "",
    symbol: "",
    decimals: 0n,
    uri: null as string | null,
    owner: "STOWNER",
    initialized: false,
    paused: false,
    totalSupply: 0n,
    balances: new Map<string, bigint>(),
    snapshots: new Map<bigint, Snapshot>(),
    lastSnapshotId: 0n,
    delegates: new Map<string, Delegate>(),
    checkpoints: new Map<
      string,
      Array<{ "from-block": bigint; power: bigint }>
    >(),
  };
  blockHeight = 1000n;
  caller = "STOWNER";

  reset() {
    this.state = {
      name: "",
      symbol: "",
      decimals: 0n,
      uri: null,
      owner: "STOWNER",
      initialized: false,
      paused: false,
      totalSupply: 0n,
      balances: new Map(),
      snapshots: new Map(),
      lastSnapshotId: 0n,
      delegates: new Map(),
      checkpoints: new Map(),
    };
    this.blockHeight = 1000n;
    this.caller = "STOWNER";
  }

  initialize(
    name: string,
    symbol: string,
    decimals: bigint,
    uri: string | null
  ) {
    if (this.state.initialized)
      return { ok: false, value: ERR_ALREADY_INITIALIZED };
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.name = name;
    this.state.symbol = symbol;
    this.state.decimals = decimals;
    this.state.uri = uri;
    this.state.initialized = true;
    this.mint(500_000_000_000n, this.caller);
    return { ok: true, value: true };
  }

  transfer(amount: bigint, sender: string, recipient: string) {
    if (this.state.paused) return { ok: false, value: ERR_PAUSED };
    if (amount <= 0n) return { ok: false, value: ERR_ZERO_AMOUNT };
    const sBal = this.state.balances.get(sender) || 0n;
    if (sBal < amount) return { ok: false, value: 104 };
    this.state.balances.set(sender, sBal - amount);
    this.state.balances.set(
      recipient,
      (this.state.balances.get(recipient) || 0n) + amount
    );
    return { ok: true, value: true };
  }

  mint(amount: bigint, recipient: string) {
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_UNAUTHORIZED };
    if (amount <= 0n) return { ok: false, value: ERR_ZERO_AMOUNT };
    this.state.totalSupply += amount;
    this.state.balances.set(
      recipient,
      (this.state.balances.get(recipient) || 0n) + amount
    );
    return { ok: true, value: true };
  }

  burn(amount: bigint, sender: string) {
    if (amount <= 0n) return { ok: false, value: ERR_ZERO_AMOUNT };
    const bal = this.state.balances.get(sender) || 0n;
    if (bal < amount) return { ok: false, value: 104 };
    this.state.balances.set(sender, bal - amount);
    this.state.totalSupply -= amount;
    return { ok: true, value: true };
  }

  pause() {
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_UNAUTHORIZED };
    if (this.state.paused) return { ok: false, value: ERR_PAUSED };
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpause() {
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_UNAUTHORIZED };
    if (!this.state.paused) return { ok: false, value: 106 };
    this.state.paused = false;
    return { ok: true, value: true };
  }

  createSnapshot() {
    if (this.caller !== this.state.owner)
      return { ok: false, value: ERR_UNAUTHORIZED };
    const id = this.state.lastSnapshotId + 1n;
    this.state.snapshots.set(id, {
      "total-supply": this.state.totalSupply,
      "block-height": this.blockHeight,
    });
    this.state.lastSnapshotId = id;
    return { ok: true, value: id };
  }

  delegateVotingPower(to: string, expires: bigint | null) {
    if (to === this.caller) return { ok: false, value: 101 };
    this.state.delegates.set(this.caller, {
      delegate: to,
      "expires-at": expires,
    });
    return { ok: true, value: true };
  }

  getBalance(account: string) {
    return this.state.balances.get(account) || 0n;
  }

  getSnapshot(id: bigint) {
    return this.state.snapshots.get(id) || null;
  }
}

describe("MGD Token", () => {
  let token: MGDTokenMock;

  beforeEach(() => {
    token = new MGDTokenMock();
    token.reset();
  });

  it("initializes with correct params", () => {
    const res = token.initialize("MicroGrid DAO Token", "MGD", 6n, null);
    expect(res.ok).toBe(true);
    expect(token.state.name).toBe("MicroGrid DAO Token");
    expect(token.state.balances.get("STOWNER")).toBe(500_000_000_000n);
  });

  it("mints governance tokens to owner", () => {
    token.initialize("MGD", "MGD", 6n, null);
    expect(token.state.totalSupply).toBe(500_000_000_000n);
  });

  it("transfers tokens between users", () => {
    token.initialize("MGD", "MGD", 6n, null);
    token.transfer(1000n, "STOWNER", "STALICE");
    expect(token.getBalance("STALICE")).toBe(1000n);
    expect(token.getBalance("STOWNER")).toBe(500_000_000_000n - 1000n);
  });

  it("pauses and unpauses transfers", () => {
    token.initialize("MGD", "MGD", 6n, null);
    token.pause();
    const transfer = token.transfer(500n, "STOWNER", "STBOB");
    expect(transfer.ok).toBe(false);
    token.unpause();
    const transfer2 = token.transfer(500n, "STOWNER", "STBOB");
    expect(transfer2.ok).toBe(true);
  });

  it("creates supply snapshots", () => {
    token.initialize("MGD", "MGD", 6n, null);
    token.mint(1000n, "STALICE");
    const snap = token.createSnapshot();
    expect(snap.ok).toBe(true);
    expect(snap.value).toBe(1n);
    const data = token.getSnapshot(1n);
    expect(data?.["total-supply"]).toBe(500_000_001_000n);
  });

  it("delegates voting power", () => {
    token.initialize("MGD", "MGD", 6n, null);
    token.transfer(10_000n, "STOWNER", "STDELEGATOR");
    token.caller = "STDELEGATOR";
    token.delegateVotingPower("STVOTER", null);
    const del = token.state.delegates.get("STDELEGATOR");
    expect(del?.delegate).toBe("STVOTER");
  });

  it("prevents self-delegation", () => {
    token.initialize("MGD", "MGD", 6n, null);
    const res = token.delegateVotingPower("STOWNER", null);
    expect(res.ok).toBe(false);
  });

  it("owner can mint additional supply", () => {
    token.initialize("MGD", "MGD", 6n, null);
    token.mint(1_000_000n, "STCOMMUNITY");
    expect(token.getBalance("STCOMMUNITY")).toBe(1_000_000n);
  });

  it("non-owner cannot mint", () => {
    token.initialize("MGD", "MGD", 6n, null);
    token.caller = "STHACKER";
    const res = token.mint(100n, "STHACKER");
    expect(res.ok).toBe(false);
  });
});
