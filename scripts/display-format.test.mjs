import test from 'node:test';
import assert from 'node:assert/strict';
import {durationText} from './display-format.mjs';

test('durations roll over and Unknown stays Unknown',()=>{
  for(const [value,label] of [[0,'0m'],[59,'<1m'],[86340,'23h 59m'],[86400,'1d 0h 0m'],[90060,'1d 1h 1m'],[null,'Unknown'],[NaN,'Unknown']])
    assert.equal(durationText(value),label);
});
