import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIRECTOR_UIDS,
  isAuthorizedUid,
  isDirectorUid,
  isStreamUid,
  STREAM_UID
} from '../src/firebase/authorizedUsers.js';

test('DIRECTOR_UIDS contains exactly the two provisioned director UIDs', () => {
  assert.deepEqual(DIRECTOR_UIDS, ['30O2lFXg0oXd5LUP2NS9mSy4Syz1', '9xjiDwmIBOVcjq8t3rZDzd1Fw8n1']);
});

test('STREAM_UID is the provisioned stream/Qniverse UID', () => {
  assert.equal(STREAM_UID, '8dvfWIUSLfNXttv9rYGsIPICpe92');
});

test('isDirectorUid recognizes both director UIDs and rejects everything else', () => {
  DIRECTOR_UIDS.forEach((uid) => assert.equal(isDirectorUid(uid), true));
  assert.equal(isDirectorUid(STREAM_UID), false);
  assert.equal(isDirectorUid('some-random-uid'), false);
  assert.equal(isDirectorUid(null), false);
  assert.equal(isDirectorUid(undefined), false);
  assert.equal(isDirectorUid(''), false);
});

test('isStreamUid recognizes only the stream UID', () => {
  assert.equal(isStreamUid(STREAM_UID), true);
  DIRECTOR_UIDS.forEach((uid) => assert.equal(isStreamUid(uid), false));
  assert.equal(isStreamUid('some-random-uid'), false);
  assert.equal(isStreamUid(null), false);
});

test('isAuthorizedUid recognizes directors and stream, rejects an unknown uid', () => {
  DIRECTOR_UIDS.forEach((uid) => assert.equal(isAuthorizedUid(uid), true));
  assert.equal(isAuthorizedUid(STREAM_UID), true);
  assert.equal(isAuthorizedUid('some-random-uid'), false);
  assert.equal(isAuthorizedUid(null), false);
});
