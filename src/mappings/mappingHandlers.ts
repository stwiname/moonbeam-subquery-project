import {Account,Nomination,Proposal,StakingReward,StakingSlash,Transfer, Vote,} from "../types";
import { MoonbeamEvent } from '@subql/contract-processors/dist/moonbeam';
import { BigNumber } from 'ethers';
import { ensureEntity, EntityFactory } from "../helpers/entity";
import { SubstrateEvent, SubstrateExtrinsic } from "@subql/types";
import {Balance} from '@polkadot/types/interfaces';

type TransferEventArgs = [string, string, BigNumber] & { from: string; to: string; value: BigNumber; };

async function ensureAccount(address: string, save = true): Promise<Account> {
    const entity = await ensureEntity(address, Account);

    entity.totalRewards = entity.totalRewards || BigInt(0);
    entity.totalSlashes = entity.totalSlashes || BigInt(0);
    entity.totalNominated = entity.totalNominated || BigInt(0);
    entity.totalCollated = entity.totalCollated || BigInt(0);

    if (save) {
        await entity.save();
    }

    return entity;
}


async function applyRewardOrSlash(factory: EntityFactory<StakingReward | StakingSlash>, event: SubstrateEvent): Promise<void> {
    const {event: {data: [account, balance]}} = event;

    const entity = await ensureEntity(`${event.block.block.header.number}-${event.idx}` , factory);

    entity.accountId = account.toString();
    entity.balance = (balance as Balance).toBigInt();
    entity.timestamp = event.block.timestamp;
    entity.blockNumber = event.block.block.header.number.toBigInt();

    await entity.save();
}

export async function handleERC20Transfer(event: MoonbeamEvent<TransferEventArgs>): Promise<void> {
    logger.warn('Calling handleERC20Transfer');
    const transfer = await ensureEntity(event.transactionHash, Transfer);

    const record: Partial<Transfer> = {
        amount: event.args.value.toBigInt(),
        toId: event.args.to,
        fromId: event.args.from,
        contractAddress: event.address,
        timestamp: null, // TODO
        blockNumber: BigInt(event.blockNumber),
        hash: event.transactionHash,
        fee: null, // TODO
    }

    Object.assign(transfer, record);

    await transfer.save();

    await ensureAccount(event.args.to);
    await ensureAccount(event.args.from);
}

export async function handleTransfer(event: SubstrateEvent) {
    logger.warn('Calling handleTransfer');
    const {event: {data: [from, to, value]}} = event;

    await ensureAccount(to.toString());
    await ensureAccount(from.toString());

    const id = event.extrinsic?.extrinsic.hash.toString() || `${event.block.hash.toString()}-${event.idx}`;
    const transfer = await ensureEntity(id, Transfer);

    const record: Partial<Transfer> = {
        amount: (value as Balance).toBigInt(),
        toId: to.toString(),
        fromId: from.toString(),
        contractAddress: 'MOVR', // TODO something else?
        timestamp: event.block.timestamp, // TODO
        blockNumber: event.block.block.header.number.toBigInt(),
        hash: event.extrinsic?.extrinsic.hash.toString(),
        fee: null, // TODO
    }

    Object.assign(transfer, record);
    await transfer.save();

}

type StandardVote = { vote: string; balance: string; };
type SplitVote = { aye: string; nay: string; };
type AccountVote = { standard: StandardVote; } | { split: SplitVote; };

function isStandardVote(vote: AccountVote): vote is { standard: StandardVote; } {
    return !!(vote as any).standard;
}

export async function handleVote(call: SubstrateExtrinsic) {
    logger.warn('Calling handleVote');
    const { extrinsic: { args: [refIndex, accountVote]}} = call;

    await ensureAccount(call.extrinsic.signer.toString());

    const vote = await ensureEntity(call.extrinsic.hash.toString(), Vote);
    const accountVoteParsed = accountVote.toJSON() as AccountVote;

    if (isStandardVote(accountVoteParsed)) {
        vote.amount = BigInt(accountVoteParsed.standard.balance);
        vote.aye = accountVoteParsed.standard.vote === '0x80';
    } else {
        throw new Error(`Unhandled vote type: ${accountVoteParsed}`);
    }

    vote.voterId = call.extrinsic.signer.toString();
    vote.refIndex = refIndex.toJSON() as number;
    vote.blockNumber = call.block.block.header.number.toBigInt();
    vote.timestamp = call.block.timestamp;

    await vote.save();
}


export async function handleReward(event: SubstrateEvent) {
    // logger.warn('Calling handleReward');
    const {event: {data: [account, balance]}} = event;

    const accountEntity = await ensureAccount(account.toString(), false);
    accountEntity.totalRewards += (balance as Balance).toBigInt();
    await accountEntity.save();

    await applyRewardOrSlash(StakingReward, event);
}

export async function handleSlash(event: SubstrateEvent) {
    logger.warn('Calling handleSlash');
    const {event: {data: [account, balance]}} = event;

    const accountEntity = await ensureAccount(account.toString(), false);
    accountEntity.totalRewards += (balance as Balance).toBigInt();
    await accountEntity.save();

    await applyRewardOrSlash(StakingReward, event);
}

export async function handleProposal(event: SubstrateEvent): Promise<void> {
    logger.warn('Calling handleProposal');
    const {event: {data: [index, balance]}} = event;

    await ensureAccount(event.extrinsic.extrinsic.signer.toString());

    const entity = await ensureEntity(index.toString(), Proposal);
    entity.accountId = event.extrinsic.extrinsic.signer.toString();
    entity.amount = (balance as Balance).toBigInt();
    await entity.save();
}

export async function handleNomination(event: SubstrateEvent): Promise<void> {
    logger.warn('Calling handleNomination');
    const {event: {data: [nominator, balance, collator]}} = event;

    await ensureAccount(nominator.toString());

    const account = await ensureAccount(collator.toString(), false);
    account.totalNominated += (balance as Balance).toBigInt();
    await account.save();

    const nomination = await ensureEntity(`${nominator.toString()}-${collator.toString()}`, Nomination);
    nomination.amount = (balance as Balance).toBigInt();
    nomination.nominatorId = nominator.toString();
    nomination.collatorId = collator.toString();
    await nomination.save();

}

export async function handelNominationIncreased(event: SubstrateEvent): Promise<void> {
    logger.warn('Calling handelNominationIncreased');
    const {event: {data: [nominator, collator, balance]}} = event;

    const nomination = await ensureEntity(`${nominator.toString()}-${collator.toString()}`, Nomination);
    nomination.amount += (balance as Balance).toBigInt();
    await nomination.save();

    const account = await ensureAccount(collator.toString(), false);
    account.totalNominated += (balance as Balance).toBigInt();
    await account.save();
}

export async function handelNominationDecreased(event: SubstrateEvent): Promise<void> {
    logger.warn('Calling handelNominationDecreased');
    const {event: {data: [nominator, collator, balance]}} = event;

    const account = await ensureAccount(collator.toString(), false);
    account.totalNominated -= (balance as Balance).toBigInt();
    await account.save();

    const nomination = await ensureEntity(`${nominator.toString()}-${collator.toString()}`, Nomination);
    nomination.amount -= (balance as Balance).toBigInt();
    await nomination.save();
}

export async function handleNominationRevoke(event: SubstrateEvent): Promise<void> {
    logger.warn('Calling handleNominationRevoke');
    const {event: {data: [round, collator, exitRound]}} = event;

    const nomination = await ensureEntity(`${event.extrinsic.extrinsic.signer.toString()}-${collator.toString()}`, Nomination);

    const previousAmount = nomination.amount;
    nomination.amount = BigInt(0);
    await nomination.save();

    const account = await ensureAccount(collator.toString(), false);
    account.totalNominated -= previousAmount;
    await account.save();
}

export async function handleJoinCollators(event: SubstrateEvent): Promise<void> {
    logger.warn('Calling handleJoinCollators');
    const {event: {data: [collator, amountLocked, newTotalAmountLocked]}} = event;

    const account = await ensureAccount(collator.toString(), false);

    account.totalCollated = (amountLocked as Balance).toBigInt();
    await account.save();
}

export async function handelCollationIncrease(event: SubstrateEvent): Promise<void> {
    logger.warn('Calling handelCollationIncrease');
    const {event: {data: [collator, oldOld, newBond]}} = event;

    const account = await ensureAccount(collator.toString(), false);

    account.totalCollated += (newBond as Balance).toBigInt();
    await account.save();
}

export async function handelCollationDecrease(event: SubstrateEvent): Promise<void> {
    logger.warn('Calling handelCollationDecrease');
    const {event: {data: [collator, oldOld, newBond]}} = event;

    const account = await ensureAccount(collator.toString(), false);

    account.totalCollated -= (newBond as Balance).toBigInt();
    await account.save();
}

export async function handleCollationExit(event: SubstrateEvent): Promise<void> {
    logger.warn('Calling handleCollationExit');
    const {event: {data: [round, collator, exitRound]}} = event;

    const account = await ensureAccount(collator.toString(), false);

    account.totalCollated = BigInt(0);
    await account.save();
}

