import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEARN_TOPICS, LEARN_CONTENT } from '../lib/learnContent.js';
import { corpusPassages, asSentence, tidyLabel, tidyText } from '../lib/corpusPassages.js';

const { passages, skipped } = corpusPassages(LEARN_TOPICS, LEARN_CONTENT);

test('every passage and label Luna can quote reads cleanly', () => {
  assert.ok(passages.length >= 19, `expected the full corpus, got ${passages.length}`);
  assert.deepEqual(skipped, []);
  for (const p of passages) {
    for (const text of [p.passage, p.source_label]) {
      assert.equal(text.includes('\u2014'), false, `em dash in: ${text.slice(0, 80)}`);
      assert.doesNotMatch(text, /\.\.|\.;|;\.|,\./, `doubled punctuation in: ${text.slice(0, 80)}`);
    }
    assert.match(p.passage, /[.!?]$/, `passage does not end a sentence: ${p.passage.slice(-40)}`);
    assert.match(p.source_url, /^https:\/\//);
    assert.match(p.retrieved, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('the radon passages read as the source does, without the old artifacts', () => {
  const what = passages.find((p) => p.passage.startsWith('Radon is'));
  assert.ok(what, 'the radon passage starts with the source sentence, not "RADON, "');
  const ways = passages.find((p) => p.passage.startsWith('Ways to reduce radon exposure: '));
  assert.ok(ways);
  assert.match(ways.passage, /mailed to a lab\. Test in winter/);
  assert.match(ways.passage, /long-term fix\.$/);
  assert.equal(ways.source_label, "EPA: A Citizen's Guide to Radon (2016)");
  assert.ok(passages.some((p) => p.passage.startsWith('Ways to reduce PFAS exposure: ')));
  assert.ok(passages.some((p) => p.passage.startsWith('Ways to reduce air pollution exposure: ')));
});

test('helpers: one terminal mark, em dash as comma, first label dash as colon', () => {
  assert.equal(asSentence('mailed to a lab.'), 'mailed to a lab.');
  assert.equal(asSentence('Seek shade between 10am and 4pm'), 'Seek shade between 10am and 4pm.');
  assert.equal(asSentence('Keep going;'), 'Keep going.');
  assert.equal(tidyText('Test \u2014 it is the only way'), 'Test, it is the only way');
  assert.equal(tidyLabel('CDC \u2014 Mold'), 'CDC: Mold');
});
