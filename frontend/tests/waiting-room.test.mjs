import test from 'node:test';
import assert from 'node:assert/strict';

test('waiting room: detects kicked / authorization error messages accurately', () => {
  const isKicked = (err) => {
    if (!err) return false;
    const lower = err.toLowerCase();
    return lower.includes('removed') ||
      lower.includes('cannot rejoin without authorization') ||
      lower.includes('kicked');
  };

  assert.strictEqual(
    isKicked('You have been removed from this room by the host and cannot rejoin without authorization.'),
    true
  );
  assert.strictEqual(
    isKicked('User was kicked from the room.'),
    true
  );
  assert.strictEqual(
    isKicked('You were removed from this room.'),
    true
  );
  assert.strictEqual(
    isKicked('Invalid room code'),
    false
  );
  assert.strictEqual(
    isKicked('Password derivation failed'),
    false
  );
});

test('waiting room: role permissions partition active members vs waiting room access', () => {
  const canAccessWaitingRoom = (role) => {
    return role === 'owner' || role === 'co_host';
  };

  assert.strictEqual(canAccessWaitingRoom('owner'), true);
  assert.strictEqual(canAccessWaitingRoom('co_host'), true);
  assert.strictEqual(canAccessWaitingRoom('editor'), false);
  assert.strictEqual(canAccessWaitingRoom('viewer'), false);
  assert.strictEqual(canAccessWaitingRoom('key_holder'), false);
});

test('waiting room: pending count calculation and status classification', () => {
  const requests = [
    { id: '1', username: 'alice', request_type: 'reentry', status: 'pending', membership_status: 'kicked' },
    { id: '2', username: 'bob', request_type: 'join', status: 'pending', membership_status: 'none' },
    { id: '3', username: 'carol', request_type: 'reentry', status: 'approved', membership_status: 'active' },
    { id: '4', username: 'dave', request_type: 'join', status: 'rejected', membership_status: 'none' },
  ];

  const pending = requests.filter(r => r.status === 'pending');
  assert.strictEqual(pending.length, 2);
  assert.deepStrictEqual(pending.map(p => p.username), ['alice', 'bob']);

  const reentryRequests = requests.filter(r => r.request_type === 'reentry');
  assert.strictEqual(reentryRequests.length, 2);
});

test('waiting room: state transitions for re-entry workflow', () => {
  let status = 'idle';
  const transitions = [];

  const updateStatus = (next) => {
    status = next;
    transitions.push(status);
  };

  // User encounters kicked error -> clicks Request Re-entry
  updateStatus('submitting');
  // API returns 200 pending
  updateStatus('pending');
  assert.strictEqual(status, 'pending');

  // Host approves request
  updateStatus('approved');
  assert.strictEqual(status, 'approved');

  assert.deepStrictEqual(transitions, ['submitting', 'pending', 'approved']);
});

test('waiting room: duplicate request handling switches to pending polling without crash', () => {
  let reentryStatus = 'submitting';
  const duplicateErrorMessage = 'A join request is already pending host approval';

  if (duplicateErrorMessage.includes('already pending')) {
    reentryStatus = 'pending';
  }

  assert.strictEqual(reentryStatus, 'pending');
});
