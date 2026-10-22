// Deterministic synthetic ~/.codex trees for the settings reader tests.
// Every value here is fictional. PRIVATE markers must never reach a report.
import fs from 'node:fs';
import path from 'node:path';

export const FIXED_NOW='2026-10-15T12:00:00.000Z';

const usage=(n,extra={})=>({input_tokens:n,cached_input_tokens:Math.floor(n/2),cache_write_input_tokens:Math.floor(n/10),
  output_tokens:Math.floor(n/5),reasoning_output_tokens:Math.floor(n/20),total_tokens:n+Math.floor(n/5),...extra});
const meta=(id,extra={})=>({timestamp:'2026-10-14T10:00:00Z',type:'session_meta',payload:{id,cwd:'PRIVATE_CWD',base_instructions:'PRIVATE_TEXT',...extra}});
const context=(timestamp,model,effort,turn,extra={})=>({timestamp,type:'turn_context',payload:{turn_id:turn,model,effort,cwd:'PRIVATE_CWD',...extra}});
const settings=(timestamp,values)=>({timestamp,type:'event_msg',payload:{type:'thread_settings_applied',thread_settings:{...values,cwd:'PRIVATE_CWD'}}});
const tokens=(timestamp,total,last=null,extra={})=>({timestamp,type:'event_msg',
  payload:{type:'token_count',info:{total_token_usage:typeof total==='number'?usage(total):total,...(last===null?{}:{last_token_usage:typeof last==='number'?usage(last):last}),...extra}}});
const call=(timestamp,name,id,extra={})=>({timestamp,type:'response_item',payload:{type:'function_call',name,call_id:id,arguments:'PRIVATE_ARGUMENTS',...extra}});
const message=timestamp=>({timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'PRIVATE_PROMPT'}]}});

// Lines are objects, raw strings or raw bytes. Files end with a newline unless asked not to.
function save(root,relative,lines,{newline=true}={}) {
  const file=path.join(root,relative);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const parts=lines.map(line=>Buffer.isBuffer(line)?line:Buffer.from(typeof line==='string'?line:JSON.stringify(line),'utf8'));
  const joined=Buffer.concat(parts.flatMap((part,i)=>i?[Buffer.from('\n'),part]:[part]));
  fs.writeFileSync(file,newline&&parts.length?Buffer.concat([joined,Buffer.from('\n')]):joined);
}

const day='2026-10-14';
const at=(time,offset='Z')=>`${day}T${time}${offset}`;

const FIXTURES={
  basic(root) {
    save(root,'sessions/2026/10/14/rollout-2026-10-14T10-00-00-alpha.jsonl',[
      meta('alpha'),
      context(at('10:00:01'),'gpt-6-astra','high','turn-a1'),
      settings(at('10:00:02'),{model:'gpt-6-astra',reasoning_effort:'ultra',service_tier:'priority'}),
      message(at('10:00:02')),
      tokens(at('10:00:03'),1000),
      tokens(at('10:00:04'),1000),
      call(at('10:01:00'),'exec_command','call-1'),
      call(at('10:01:01'),'exec_command','call-1'),
      {timestamp:at('10:01:02'),type:'response_item',payload:{type:'custom_tool_call',name:'apply_patch',call_id:'call-2',input:'PRIVATE_PATCH'}},
      call(at('10:01:03'),'browser_navigate','call-3',{namespace:'mcp__browser'}),
      call(at('10:01:04'),'web.search_query','call-4'),
      call(at('10:01:05'),'notes.read','call-5'),
      call(at('10:01:06'),'read','call-6',{namespace:'history'}),
      call(at('10:01:07'),'PRIVATE NAME','call-7'),
      call(at('10:01:08'),'spawn_agent','call-8',{namespace:'functions'}),
      call(at('10:01:09'),'write_stdin',12345),
      call(at('10:01:10'),'Shell_Tool','call-9',{namespace:'BAD NAMESPACE'}),
      call('2026-10-01T12:00:00Z','exec_command','call-old'),
      tokens(at('10:05:00'),2500),
      context(at('10:06:00'),'gpt-5.6-sol','medium','turn-a2',{service_tier:'default'}),
      tokens(at('10:06:30'),300,300),
      settings(at('10:07:00'),{model:'gpt-6-astra',service_tier:'fast'}),
      tokens(at('10:08:00'),900),
      context(at('10:09:00'),'gpt-6-astra','xhigh','turn-a3'),
      tokens(at('10:10:00'),1400),
      tokens('2026-10-01T12:00:00Z',1500),
      tokens(at('10:11:00'),usage(1600,{output_tokens:-5})),
      tokens(at('10:12:00'),{input_tokens:2000,cached_input_tokens:100,output_tokens:100,reasoning_output_tokens:0,total_tokens:9999}),
      tokens(at('10:13:00'),{input_tokens:2100.5,cached_input_tokens:100.25,output_tokens:150.5,reasoning_output_tokens:1.5,total_tokens:2251}),
      tokens(at('06:30:00','-04:00'),usage(2300)),
      tokens(at('12:00:00.123','+00:00'),2400),
      tokens(`${day} 12:30:00Z`,2500),
      tokens(at('12:40:00.123456','+05:30'),2600),
      tokens(at('12:50:00','+00:00:30'),2700),
      tokens(at('23:59:59.999999','-05:00'),2800),
      'not json',
      '[1,2,3]',
      '',
      '   ',
      '{"timestamp":"2026-10-14T13:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":'+JSON.stringify(usage(2900))+'}}}\r',
      {timestamp:at('13:01:00'),type:'event_msg',payload:null},
      {timestamp:at('13:02:00'),type:'event_msg',payload:[]},
      {timestamp:at('13:03:00'),type:'event_msg',payload:'PRIVATE_STRING'},
      {timestamp:at('13:04:00'),type:'event_msg',payload:{type:'token_count',info:''}},
      {timestamp:at('13:05:00'),type:'event_msg',payload:{type:'token_count',info:0}},
      {timestamp:at('13:06:00'),type:'event_msg',payload:{type:'token_count',info:{total_token_usage:[]}}},
      {type:'event_msg',payload:{type:'token_count',info:{total_token_usage:usage(3000)}}},
      tokens(at('13:07:00'),usage(3100,{cache_write_input_tokens:undefined})),
    ]);
    save(root,'sessions/2026/10/13/rollout-2026-10-13T08-00-00-beta.jsonl',[
      meta('beta'),
      context('2026-11-01T05:00:00Z','gpt-6-astra','low','turn-b1'),
      tokens('2026-11-01T05:30:00Z',100),
      tokens('2026-11-01T06:30:00Z',200),
      tokens('2026-03-08T06:59:59Z',300),
      tokens('2026-03-08T07:00:00Z',400),
      call('2026-11-01T05:31:00Z','exec_command','beta-call'),
    ],{newline:false});
    save(root,'archived_sessions/rollout-2025-01-02T03-04-05-gamma.jsonl',[
      meta('gamma'),
      context('2025-01-02T03:04:05Z','gpt-5','minimal','turn-g1'),
      tokens('2025-01-02T03:05:00Z',700),
      tokens('1883-11-18T16:59:59Z',800),
      tokens('1883-11-18T17:00:00Z',900),
    ]);
  },
  lineage(root) {
    const shared=[context(at('09:00:00'),'gpt-6-astra','high','shared-turn'),tokens(at('09:00:01'),1000),tokens(at('09:00:02'),1500)];
    save(root,'sessions/2026/10/14/rollout-parent.jsonl',[meta('lin-parent'),...shared,tokens(at('09:00:03'),1800)]);
    save(root,'archived_sessions/rollout-parent-copy.jsonl',[meta('lin-parent'),...shared]);
    save(root,'sessions/2026/10/14/rollout-child.jsonl',[meta('lin-child',{forked_from_id:'lin-parent'}),...shared,
      context(at('09:10:00'),'gpt-6-astra','high','child-turn'),tokens(at('09:10:01'),2500)]);
    save(root,'archived_sessions/rollout-grand.jsonl',[meta('lin-grand',{parent_thread_id:'lin-child'}),...shared,
      context(at('09:10:00'),'gpt-6-astra','high','child-turn'),tokens(at('09:10:01'),2500),tokens(at('09:20:00'),3000)]);
    save(root,'sessions/2026/10/14/rollout-other.jsonl',[meta('lin-other'),...shared]);
    save(root,'sessions/2026/10/14/rollout-orphan.jsonl',[meta('lin-orphan',{forked_from_id:'lin-missing'}),...shared]);
    save(root,'sessions/2026/10/14/rollout-numeric-key.jsonl',[meta('lin-numeric',{forked_from_id:'lin-parent'}),
      context(at('09:00:00'),'gpt-6-astra','high','ignored',{usage_turn_key:7}),tokens(at('09:00:01'),1000),
      context(at('09:00:00'),'gpt-6-astra','high','ignored',{usage_turn_key:7.0}),tokens(at('09:00:01'),1000)]);
  },
  malformed(root) {
    save(root,'sessions/empty.jsonl',[],{newline:false});
    save(root,'sessions/no-meta.jsonl',['not json',tokens(at('11:00:00'),100)]);
    save(root,'sessions/list-meta.jsonl',[{type:'session_meta',payload:[]},tokens(at('11:00:00'),200)]);
    save(root,'sessions/string-meta.jsonl',[{type:'session_meta',payload:'PRIVATE_META'},tokens(at('11:00:00'),300)]);
    save(root,'sessions/empty-id.jsonl',[meta(''),tokens(at('11:00:00'),400)]);
    save(root,'sessions/a/b/c/deep.jsonl',[meta('deep'),tokens(at('11:00:00'),500)]);
    save(root,'sessions/notes.txt',[meta('ignored'),tokens(at('11:00:00'),600)]);
    save(root,'sessions/bom.jsonl',[meta('bom'),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(JSON.stringify(tokens(at('11:00:00'),700)))]),
      tokens(at('11:01:00'),800)]);
    save(root,'sessions/utf16.jsonl',[meta('utf16'),Buffer.from(JSON.stringify(tokens(at('11:00:00'),900)),'utf16le'),'',tokens(at('11:02:00'),950)]);
    save(root,'sessions/constants.jsonl',[meta('constants'),
      '{"timestamp":"2026-10-14T11:00:00Z","type":"event_msg","payload":{"type":"token_count","note":NaN,"info":{"total_token_usage":'+JSON.stringify(usage(1000))+'}}}',
      '{"timestamp":"2026-10-14T11:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":Infinity,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":1}}}}',
      '{"timestamp":"2026-10-14T11:02:00Z","type":"turn_context","payload":{"model":"gpt-6-astra","effort":-Infinity,"turn_id":"t"}}',
      tokens(at('11:03:00'),1200)]);
    save(root,'sessions/timestamps.jsonl',[meta('timestamps'),
      context('2026-10-14','gpt-6-astra','high','naive-context'),
      ...['2026-13-01T00:00:00Z','2026-10-14T25:00:00Z','yesterday','2026-10-14T12:00:00+24:00','2026-10-14T12:00:00.1234Z',
        '2026-02-29T00:00:00Z','0000-01-01T00:00:00Z','2026-10-14T12:00:00+05:99','2026-10-14T12Z','2026-10-14T12:30:15:123Z',
        '2026-10-14é12:00:00Z','2026-10-14T12:00:00+00:00:00.500000','2026-10-14t12:00:00z','2026-10-14T12:00:00ZZ',
        '2028-02-29T23:59:59.5+12:00','2026-10-14T12:00:00+0530','x'.repeat(70)]
        .map((timestamp,i)=>tokens(timestamp,2000+i*100))]);
    const big=JSON.stringify(tokens(at('11:00:00'),5000));
    save(root,'sessions/oversize.jsonl',[meta('oversize'),
      'x'.repeat(8_000_001),
      tokens(at('11:01:00'),5100),
      big+' '.repeat(8_000_000-big.length-1),
      tokens(at('11:02:00'),5200),
      big.replace('5000','5300')+' '.repeat(8_000_000-big.length),
      tokens(at('11:03:00'),5400)]);
    save(root,'sessions/long-first.jsonl',[' '.repeat(4_000_001),tokens(at('11:00:00'),6000)]);
    save(root,'sessions/payload-shapes.jsonl',[meta('shapes'),
      {timestamp:at('11:00:00'),type:'turn_context',payload:null},
      tokens(at('11:00:01'),100),
      {timestamp:at('11:00:02'),type:'turn_context',payload:{model:'x'.repeat(101),effort:'turbo',service_tier:'flex'}},
      tokens(at('11:00:03'),300),
      {timestamp:at('11:00:04'),type:'event_msg',payload:{type:'thread_settings_applied',thread_settings:null}},
      {timestamp:at('11:00:05'),type:'event_msg',payload:{type:'thread_settings_applied',thread_settings:'PRIVATE'}},
      {timestamp:at('11:00:06'),type:'turn_context',payload:{type:'thread_settings_applied',thread_settings:{model:'gpt-6-nova',reasoning_effort:'max',service_tier:'priority'}}},
      tokens(at('11:00:07'),500),
      {timestamp:at('11:00:08'),type:'turn_context',payload:{model:'modèle-é',effort:'high',turn_id:'unicode-turn'}},
      tokens(at('11:00:09'),700)]);
  },
  inventory(root) {
    save(root,'sessions/one.jsonl',[meta('inv-one',{session_id:'inv-one-session'}),tokens(at('08:00:00'),100)]);
    save(root,'sessions/two.jsonl',[meta('inv-two',{forked_from_id:'inv-one',parent_thread_id:'inv-zero'}),tokens(at('08:00:00'),200)]);
    save(root,'sessions/three.jsonl',[{type:'session_meta',payload:{session_id:'only-session'}},tokens(at('08:00:00'),300)]);
    save(root,'archived_sessions/long-id.jsonl',[meta('i'.repeat(129)),tokens(at('08:00:00'),400)]);
  },
  'missing-folders'() {},
  // Each crash fixture fails in Python for at least one reading mode.
  'crash-null-timestamp'(root) {
    save(root,'sessions/one.jsonl',[meta('crash'),{timestamp:null,type:'event_msg',payload:{type:'other'}},tokens(at('08:00:00'),100)]);
  },
  'crash-naive-token'(root) {
    save(root,'sessions/one.jsonl',[meta('crash'),tokens('2026-10-14T08:00:00',100)]);
  },
  'crash-naive-tool'(root) {
    save(root,'sessions/one.jsonl',[meta('crash'),call('2026-10-14T08:00:00','exec_command','naive'),tokens(at('08:00:00'),100)]);
  },
  'crash-overflow'(root) {
    save(root,'sessions/one.jsonl',[meta('crash'),context('0001-01-01T00:00:00Z','gpt-6-astra','high','old'),tokens(at('08:00:00'),100)]);
  },
  'crash-overflow-utc'(root) {
    save(root,'sessions/one.jsonl',[meta('crash'),tokens('9999-12-31T23:00:00-05:00',100),tokens(at('08:00:00'),200)]);
  },
  'crash-body-utf8'(root) {
    save(root,'sessions/one.jsonl',[meta('crash'),Buffer.from([0x7b,0xff,0x7d]),tokens(at('08:00:00'),100)]);
  },
  'crash-info-string'(root) {
    save(root,'sessions/one.jsonl',[meta('crash'),{timestamp:at('08:00:00'),type:'event_msg',payload:{type:'token_count',info:'PRIVATE'}},tokens(at('08:00:01'),100)]);
  },
  'crash-unhashable-tier'(root) {
    save(root,'sessions/one.jsonl',[meta('crash'),context(at('08:00:00'),'gpt-6-astra',['high'],'t',{service_tier:['fast']}),tokens(at('08:00:01'),100)]);
  },
  'crash-surrogate-turn'(root) {
    save(root,'sessions/one.jsonl',[meta('crash'),'{"timestamp":"2026-10-14T08:00:00Z","type":"turn_context","payload":{"model":"gpt-6-astra","effort":"high","turn_id":"\\ud800"}}',tokens(at('08:00:01'),100)]);
  },
  'crash-unhashable-turn-key'(root) {
    save(root,'sessions/one.jsonl',[meta('crash'),context(at('08:00:00'),'gpt-6-astra','high','t',{usage_turn_key:['k']}),tokens(at('08:00:01'),100)]);
  },
  'crash-meta-utf8'(root) {
    save(root,'sessions/one.jsonl',[Buffer.from([0x7b,0xc3,0x28,0x7d]),tokens(at('08:00:00'),100)]);
  },
  'crash-directory'(root) {
    fs.mkdirSync(path.join(root,'sessions/folder.jsonl'),{recursive:true});
  },
};

// Fixtures whose result depends on directory order are compared live but not saved.
export const FIXTURE_NAMES=Object.keys(FIXTURES);
export const fixtureOptions=()=>({now:new Date(FIXED_NOW)});

export function buildFixture(root,name) {
  if(!FIXTURES[name])throw Error(`Unknown fixture ${name}`);
  fs.mkdirSync(root,{recursive:true});
  FIXTURES[name](root);
  return root;
}
