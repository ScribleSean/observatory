// "My apps": the user's own rules that name the apps and sites they care about, from window app names and titles.
// The rules live in observatory.config.json (activity.apps). The code ships none, so time is only ever labeled
// with names the user chose. A rule with only `title` matches browser windows, so a chat or a document named
// after a project is not counted as time in that project. A rule with `app` matches that app's windows, and
// with `title` too, only those of its windows whose title matches.
import {createHash} from 'node:crypto';

export const MAX_APP_RULES=100;
export const MAX_PATTERN=300;
// oxlint-disable-next-line no-control-regex -- refusing control characters is the point
const control=/[\u0000-\u001f\u007f]/;
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
export const appLabelOk=value=>typeof value==='string' && value.trim().length>0 && value.length<=40 && !control.test(value);

function pattern(value,where) {
  if(value===undefined)return null;
  if(typeof value!=='string' || !value || value.length>MAX_PATTERN || control.test(value))throw Error(`${where} must be a regular expression of at most ${MAX_PATTERN} characters`);
  try {new RegExp(value,'iu');} catch {throw Error(`${where} is not a valid regular expression`);}
  return value;
}

/** activity.apps from the settings file: [{label, app?, title?}], checked. */
export function parseAppRules(raw) {
  if(raw===undefined)return [];
  if(!Array.isArray(raw))throw Error('activity.apps must be a list of rules');
  if(raw.length>MAX_APP_RULES)throw Error(`activity.apps holds at most ${MAX_APP_RULES} rules`);
  return raw.map((rule,index)=>{
    const where=`activity.apps[${index}]`;
    if(!object(rule))throw Error(`${where} must be an object`);
    const extra=Object.keys(rule).find(key=>!['label','app','title'].includes(key));
    if(extra)throw Error(`${where} has unknown setting ${extra}`);
    if(!appLabelOk(rule.label))throw Error(`${where}.label must be a short name`);
    const app=pattern(rule.app,`${where}.app`),title=pattern(rule.title,`${where}.title`);
    if(app===null && title===null)throw Error(`${where} needs app, title or both`);
    return {label:rule.label.trim(),app,title};
  });
}

/** The labels the rules can give, in rule order, each once. */
export const ruleLabels=rules=>[...new Set((rules ?? []).map(rule=>rule.label))];

/** A short key that changes whenever the rules do, so days labeled under older rules are labeled again. */
export const rulesKey=rules=>rules?.length?createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0,16):null;

/**
 * A function from one window to its label, or null when no rule matches. The first matching rule wins.
 * @param {{label: string, app: string | null, title: string | null}[]} rules
 * @returns {(window: {app: unknown, title: unknown, browser: boolean}) => string | null}
 */
export function appClassifier(rules) {
  const compiled=(rules ?? []).map(rule=>({label:rule.label,app:rule.app===null?null:new RegExp(rule.app,'iu'),title:rule.title===null?null:new RegExp(rule.title,'iu')}));
  return ({app,title,browser})=>{
    const name=typeof app==='string'?app:'',text=typeof title==='string'?title:'';
    for(const rule of compiled) {
      if(rule.app ? !rule.app.test(name) : !browser)continue;
      if(rule.title && !rule.title.test(text))continue;
      return rule.label;
    }
    return null;
  };
}
