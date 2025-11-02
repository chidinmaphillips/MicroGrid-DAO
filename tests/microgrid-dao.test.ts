import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_NOT_FOUND = 101;
const ERR_INVALID_AMOUNT = 103;
const ERR_VOTING_ENDED = 107;
const ERR_ALREADY_VOTED = 105;
const ERR_QUORUM_NOT_MET = 114;

interface Microgrid {
  owner: string;
  location: string;
  "capacity-kw": bigint;
  active: boolean;
  "registered-at": bigint;
}

interface Proposal {
  "grid-id": bigint;
  title: string;
  description: string;
  "amount-stx": bigint;
  proposer: string;
  "start-height": bigint;
  "end-height": bigint;
  executed: boolean;
  "yes-votes": bigint;
  "no-votes": bigint;
  "total-voted": bigint;
}

interface Vote {
  yes: boolean;
  weight: bigint;
}

class MicroGridDAOMock {
  state = {
    nextGridId: 0n,
    nextProposalId: 0n,
    oracle: null as string | null,
    quorum: 66n,
    votingDuration: 2880n,
    executionDelay: 144n,
    microgrids: new Map<bigint, Microgrid>(),
    energyReadings: new Map<string, bigint>(),
    proposals: new Map<bigint, Proposal>(),
    votes: new Map<string, Vote>(),
    treasury: new Map<string, bigint>(),
  };
  blockHeight = 1000n;
  caller = "ST1USER";
  contract = "STDAO";

  reset() {
    this.state = {
      nextGridId: 0n,
      nextProposalId: 0n,
      oracle: null,
      quorum: 66n,
      votingDuration: 2880n,
      executionDelay: 144n,
      microgrids: new Map(),
      energyReadings: new Map(),
      proposals: new Map(),
      votes: new Map(),
      treasury: new Map(),
    };
    this.blockHeight = 1000n;
    this.caller = "ST1USER";
  }

  setOracle(newOracle: string) {
    if (this.caller !== this.contract)
      return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.oracle = newOracle;
    return { ok: true, value: true };
  }

  registerMicrogrid(location: string, capacityKw: bigint) {
    if (location.length < 5 || location.length > 80)
      return { ok: false, value: 109 };
    if (capacityKw < 10n) return { ok: false, value: 110 };
    const id = this.state.nextGridId + 1n;
    this.state.microgrids.set(id, {
      owner: this.caller,
      location,
      "capacity-kw": capacityKw,
      active: true,
      "registered-at": this.blockHeight,
    });
    this.state.nextGridId = id;
    return { ok: true, value: id };
  }

  depositTreasury(amount: bigint) {
    if (amount <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };
    const bal = this.state.treasury.get(this.caller) || 0n;
    this.state.treasury.set(this.caller, bal + amount);
    return { ok: true, value: amount };
  }

  createProposal(gridId: bigint, title: string, desc: string, amount: bigint) {
    if (!this.state.microgrids.has(gridId))
      return { ok: false, value: ERR_NOT_FOUND };
    if (amount <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };
    const bal = this.state.treasury.get(this.caller) || 0n;
    if (bal < amount) return { ok: false, value: 106 };
    const id = this.state.nextProposalId + 1n;
    this.state.proposals.set(id, {
      "grid-id": gridId,
      title,
      description: desc,
      "amount-stx": amount,
      proposer: this.caller,
      "start-height": this.blockHeight,
      "end-height": this.blockHeight + this.state.votingDuration,
      executed: false,
      "yes-votes": 0n,
      "no-votes": 0n,
      "total-voted": 0n,
    });
    this.state.nextProposalId = id;
    return { ok: true, value: id };
  }

  voteProposal(propId: bigint, yes: boolean, weight: bigint) {
    const prop = this.state.proposals.get(propId);
    if (!prop) return { ok: false, value: ERR_NOT_FOUND };
    if (this.blockHeight >= prop["end-height"])
      return { ok: false, value: ERR_VOTING_ENDED };
    const key = `${propId}-${this.caller}`;
    if (this.state.votes.has(key))
      return { ok: false, value: ERR_ALREADY_VOTED };
    const bal = this.state.treasury.get(this.caller) || 0n;
    if (bal < weight) return { ok: false, value: 106 };
    this.state.votes.set(key, { yes, weight });
    const update = { ...prop };
    if (yes) update["yes-votes"] += weight;
    else update["no-votes"] += weight;
    update["total-voted"] += weight;
    this.state.proposals.set(propId, update);
    return { ok: true, value: true };
  }

  executeProposal(propId: bigint) {
    const prop = this.state.proposals.get(propId);
    if (!prop || prop.executed) return { ok: false, value: ERR_NOT_FOUND };
    if (this.blockHeight < prop["end-height"] + this.state.executionDelay)
      return { ok: false, value: ERR_VOTING_ENDED };
    const yesPercent =
      prop["total-voted"] > 0n
        ? (prop["yes-votes"] * 100n) / prop["total-voted"]
        : 0n;
    if (yesPercent < this.state.quorum)
      return { ok: false, value: ERR_QUORUM_NOT_MET };
    this.state.proposals.set(propId, { ...prop, executed: true });
    return { ok: true, value: true };
  }

  submitEnergyReading(gridId: bigint, ts: bigint, kwh: bigint) {
    if (this.state.oracle !== this.caller)
      return { ok: false, value: ERR_UNAUTHORIZED };
    if (ts < this.blockHeight) return { ok: false, value: 113 };
    if (kwh <= 0n) return { ok: false, value: 111 };
    this.state.energyReadings.set(`${gridId}-${ts}`, kwh);
    return { ok: true, value: true };
  }

  getGrid(id: bigint) {
    return this.state.microgrids.get(id) || null;
  }

  getProposal(id: bigint) {
    return this.state.proposals.get(id) || null;
  }
}

describe("MicroGridDAO Core", () => {
  let dao: MicroGridDAOMock;

  beforeEach(() => {
    dao = new MicroGridDAOMock();
    dao.reset();
    dao.caller = dao.contract;
    dao.setOracle("STORACLE");
  });

  it("registers microgrid with valid params", () => {
    dao.caller = "ST1USER";
    const res = dao.registerMicrogrid("Rural Village Alpha", 250n);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(1n);
    const grid = dao.getGrid(1n);
    expect(grid?.location).toBe("Rural Village Alpha");
    expect(grid?.["capacity-kw"]).toBe(250n);
    expect(grid?.owner).toBe("ST1USER");
  });

  it("rejects invalid location", () => {
    dao.caller = "ST1USER";
    const res = dao.registerMicrogrid("Ab", 100n);
    expect(res.ok).toBe(false);
    expect(res.value).toBe(109);
  });

  it("deposits to treasury", () => {
    dao.caller = "ST1USER";
    const res = dao.depositTreasury(5000n);
    expect(res.ok).toBe(true);
    expect(dao.state.treasury.get("ST1USER")).toBe(5000n);
  });

  it("creates proposal after deposit", () => {
    dao.caller = "ST1USER";
    dao.depositTreasury(10000n);
    dao.registerMicrogrid("Test Grid", 100n);
    const res = dao.createProposal(1n, "Add Solar", "Need panels", 3000n);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(1n);
  });

  it("oracle submits energy reading", () => {
    dao.caller = "STORACLE";
    const res = dao.submitEnergyReading(1n, dao.blockHeight + 10n, 450n);
    expect(res.ok).toBe(true);
    expect(dao.state.energyReadings.get("1-" + (dao.blockHeight + 10n))).toBe(
      450n
    );
  });

  it("blocks non-oracle energy submission", () => {
    dao.caller = "ST1USER";
    const res = dao.submitEnergyReading(1n, dao.blockHeight, 100n);
    expect(res.ok).toBe(false);
    expect(res.value).toBe(ERR_UNAUTHORIZED);
  });
});
