// Sorts a subagent's work into a WorkKind from its agent type and the short description its parent
// gave it. Only the kind leaves this module, never the description.
import {WORK_KINDS} from '../lib/ledger-shape.mjs';

// Agent types that say what they do, matched without case.
const TYPES=[
  [/^explore$|explor|search|locat|finder/,'search'],
  [/^plan$|architect|design|planner/,'design'],
  [/web-?fetch|research|guide|docs?-?lookup/,'research'],
  [/review|audit|critic|interrogat|verif/,'review'],
  [/test|qa\b/,'test'],
  [/writ|editor|technical-writing/,'write'],
];

// Descriptions, in order: the first rule that matches wins. Review comes first because "review the
// fix" is review, not a fix. Tests come before build because "run the build on the server" checks, it
// does not build. Search verbs come last among the reading kinds because "research" and "explore
// options" are not lookups.
const RULES=[
  ['review',/\b(re-?review|review\w*|audit|audits|verify|verif\w*|check|checks|critique|critic|interrogat\w*|cross-?review|claim check|second opinion|assess\w*|evaluat\w*|grade|vet|vetting|inspect\w*|sanity|proof ?read|judge|panel|accuracy|security pass|second pass)\b/i],
  ['test',/\b(tests?|testing|ci|repro\w*|smoke|benchmark\w*|bench|e2e|qa|run the build|run the suite|run the tests|parity|regression|try it|dry run|trials?|proof|confirm\w*|clean run|full suite)\b/i],
  ['write',/\b(write|write-?up|digest|draft\w*|report|handoff|brief|briefs|readme|docs|doc|notes|release notes|changelog|copy|prose|summar\w*|article|post|email|letter|announce\w*|caption\w*|words|wording|hand-?over|synthesi[sz]e\w*|reword\w*)\b/i],
  ['design',/\b(plan|plans|planning|design\w*|architect\w*|mock\w*|spec|specs|sketch\w*|pitch\w*|propos\w*|spike|brainstorm\w*|ideas?|concept\w*|logo\w*|layout|wireframe|direction\w*|ux|ui)\b/i],
  ['research',/\b(research\w*|investigat\w*|diagnos\w*|study|studies|compare|comparison|why|how|understand\w*|analy[sz]\w*|learn\w*|read|explain\w*|root cause|debug\w*|trace|dig|options|survey|intel|prior art|landscape|ground\w*)\b/i],
  ['search',/\b(search\w*|find|finds|locate|scan\w*|explore|look ?up|grep|map|mapping|inventory|list|where|catalog\w*|collect|gather|index|hunt\w*|scout\w*)\b/i],
  ['build',/\b(fix\w*|build\w*|implement\w*|add|adds|refactor\w*|update\w*|land|lands|landing|merge\w*|port|porting|wire|wiring|ship\w*|migrat\w*|clean ?up|cleanup|install\w*|set ?up|setup|patch\w*|rebase\w*|prep|harden\w*|bump|deploy\w*|create|make|convert|move|remove|rename|code|coding|feature|hook|modernize|finish|polish|restore|repair|upgrade|integrat\w*|scaffold\w*|generate|apply|edit|change|support|enable|replace|split|rewrite|mvp|publish\w*|push\w*|reinstall\w*|prototype\w*|speed ?up|swap|pin|sync|re-?sync|redesign\w*|rebuild\w*|retire|wipe|exclude|override|delete|recreate|release\w*|restart|commit|chores|squash\w*|backup|tidy|ready|fast|start)\b/i],
];

// A task that opens with one of these verbs is that kind, whatever else it mentions
// ("Find where titles are read" is a search).
const LEAD=new Map(Object.entries({find:'search',locate:'search',search:'search',scan:'search',list:'search',map:'search',grep:'search',
  review:'review','re-review':'review',audit:'review',verify:'review',check:'review',critique:'review',
  research:'research',investigate:'research',diagnose:'research',compare:'research',
  plan:'design',design:'design',sketch:'design',draft:'write',write:'write',summarize:'write',summarise:'write',
  test:'test',fix:'build',build:'build',implement:'build',add:'build',refactor:'build',land:'build'}));

export function workKind(agentType,description) {
  const type=String(agentType ?? '').toLowerCase().trim();
  for(const [pattern,kind] of TYPES)if(pattern.test(type))return kind;
  const text=String(description ?? '').replace(/[_:/]+/g,' ');
  const lead=LEAD.get(text.trim().split(/\s+/)[0]?.toLowerCase());
  if(lead)return lead;
  for(const [kind,pattern] of RULES)if(pattern.test(text))return kind;
  return 'other';
}

export const isWorkKind=value=>WORK_KINDS.includes(value);
