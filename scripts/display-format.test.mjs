import test from 'node:test';
import assert from 'node:assert/strict';
import {durationText,compactCount} from './display-format.mjs';

test('display units roll over without changing unknown coverage',()=>{
  for(const [value,label] of [[1e9,'1B'],[1e12,'1T'],[999999999,'1B'],[999999999999,'1T']])
    assert.equal(compactCount(value),label);
  for(const [value,label] of [[0,'0m'],[59,'<1m'],[86340,'23h 59m'],[86400,'1d 0h 0m'],[90060,'1d 1h 1m'],[null,'Unknown'],[NaN,'Unknown']])
    assert.equal(durationText(value),label);
});
