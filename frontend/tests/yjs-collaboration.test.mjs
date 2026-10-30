import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import StarterKit from '@tiptap/starter-kit';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';

test('simultaneous Y.Text edits converge and separate room documents stay isolated', () => {
  const roomASeed = new Y.Doc();
  roomASeed.getText('code').insert(0, 'abcd');
  const roomAInitial = Y.encodeStateAsUpdate(roomASeed);
  const roomAVector = Y.encodeStateVector(roomASeed);

  const a1 = new Y.Doc();
  const a2 = new Y.Doc();
  Y.applyUpdate(a1, roomAInitial);
  Y.applyUpdate(a2, roomAInitial);
  a1.getText('code').insert(1, 'A');
  a2.getText('code').insert(3, 'B');

  const a1Delta = Y.encodeStateAsUpdate(a1, roomAVector);
  const a2Delta = Y.encodeStateAsUpdate(a2, roomAVector);
  Y.applyUpdate(a1, a2Delta);
  Y.applyUpdate(a2, a1Delta);

  assert.equal(a1.getText('code').toString(), a2.getText('code').toString());
  assert.match(a1.getText('code').toString(), /A/);
  assert.match(a1.getText('code').toString(), /B/);

  const roomB = new Y.Doc();
  roomB.getText('code').insert(0, 'other room');
  Y.applyUpdate(roomB, a1Delta);
  assert.equal(roomB.getText('code').toString(), 'other room');

  roomASeed.destroy();
  a1.destroy();
  a2.destroy();
  roomB.destroy();
});

test('simultaneous rich-text edits converge through the Tiptap Y.XmlFragment model', () => {
  const schema = getSchema([StarterKit.configure({ history: false })]);
  const seed = prosemirrorJSONToYDoc(schema, {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abcd' }] }],
  }, 'default');
  const initial = Y.encodeStateAsUpdate(seed);
  const stateVector = Y.encodeStateVector(seed);
  const left = new Y.Doc();
  const right = new Y.Doc();
  Y.applyUpdate(left, initial);
  Y.applyUpdate(right, initial);

  left.getXmlFragment('default').get(0).get(0).insert(1, 'L');
  right.getXmlFragment('default').get(0).get(0).insert(3, 'R');
  const leftDelta = Y.encodeStateAsUpdate(left, stateVector);
  const rightDelta = Y.encodeStateAsUpdate(right, stateVector);
  Y.applyUpdate(left, rightDelta);
  Y.applyUpdate(right, leftDelta);

  const leftJson = JSON.stringify(yDocToProsemirrorJSON(left, 'default'));
  const rightJson = JSON.stringify(yDocToProsemirrorJSON(right, 'default'));
  assert.equal(leftJson, rightJson);
  assert.match(leftJson, /L/);
  assert.match(leftJson, /R/);

  seed.destroy();
  left.destroy();
  right.destroy();
});
