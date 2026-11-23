import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRecipient, isCatchAllDomain, rejectsUnknownRecipient } from '../.wrangler/recipient-tests.mjs';

const OPEN = 0;
const CLOSE = 1;

const env = {
	accounts: [
		{ accountId: 1, userId: 1, email: 'me@example.com', isDel: 0 },
		{ accountId: 2, userId: 1, email: 'old@example.com', isDel: 1 },
		{ accountId: 3, userId: 2, email: 'gone@example.com', isDel: 0 },
		{ accountId: 4, userId: 1, email: 'me+kept@example.com', isDel: 0 }
	],
	users: [
		{ userId: 1, email: 'me@example.com', isDel: 0 },
		{ userId: 2, email: 'gone@example.com', isDel: 1 }
	]
};

test('existing mailbox receives, case-insensitively', async () => {
	const { account, userRow } = await resolveRecipient(env, 'Me@Example.com', OPEN);
	assert.equal(account.accountId, 1);
	assert.equal(userRow.userId, 1);
});

test('unknown address has no recipient', async () => {
	assert.equal((await resolveRecipient(env, 'random@example.com', OPEN)).account, null);
});

test('deleted mailbox no longer receives', async () => {
	assert.equal((await resolveRecipient(env, 'old@example.com', OPEN)).account, null);
	assert.equal((await resolveRecipient(env, 'old+tag@example.com', OPEN)).account, null);
});

test('mailbox of a deleted user no longer receives', async () => {
	assert.equal((await resolveRecipient(env, 'gone@example.com', OPEN)).account, null);
});

test('plus addressing on maps a+tag@ to a@', async () => {
	assert.equal((await resolveRecipient(env, 'me+shop@example.com', OPEN)).account.accountId, 1);
});

test('plus addressing off accepts only exact addresses', async () => {
	assert.equal((await resolveRecipient(env, 'me+shop@example.com', CLOSE)).account, null);
	assert.equal((await resolveRecipient(env, 'me+kept@example.com', CLOSE)).account.accountId, 4);
	assert.equal((await resolveRecipient(env, 'me@example.com', CLOSE)).account.accountId, 1);
});

test('missing setting keeps the old plus-address behaviour', async () => {
	assert.equal((await resolveRecipient(env, 'me+shop@example.com', undefined)).account.accountId, 1);
});

test('catch-all domains accept unknown addresses even with no-recipient off', () => {
	const catchAll = ['catch.example'];
	assert.equal(rejectsUnknownRecipient(catchAll, 'anything@catch.example', CLOSE), false);
	assert.equal(rejectsUnknownRecipient(catchAll, 'Any@CATCH.Example', CLOSE), false);
	assert.equal(rejectsUnknownRecipient(catchAll, 'random@example.com', CLOSE), true);
	assert.equal(rejectsUnknownRecipient(catchAll, 'random@example.com', OPEN), false);
});

test('catch-all list accepts a comma string and ignores a missing setting', () => {
	assert.equal(isCatchAllDomain('a.example, catch.example', 'x@catch.example'), true);
	assert.equal(isCatchAllDomain(undefined, 'x@catch.example'), false);
	assert.equal(isCatchAllDomain([], 'x@catch.example'), false);
	assert.equal(isCatchAllDomain(['catch.example'], 'x@sub.catch.example'), false);
	assert.equal(isCatchAllDomain(['catch.example'], 'not-an-address'), false);
	assert.equal(rejectsUnknownRecipient(undefined, 'x@catch.example', CLOSE), true);
});
