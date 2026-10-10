import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const [major, minor] = process.versions.node.split(".").map(Number);
const supported = major > 26 || (major === 26 && minor >= 1);
const run = (script: string) => execFileSync(process.execPath,
  ["--conditions=browser", "--input-type=module", "--eval", script], { encoding: "utf8" });

test("v2 restores the original home and session routes after dashboard navigation", { skip: !supported }, () => {
  assert.doesNotThrow(() => run(`
    import assert from 'node:assert/strict';
    import {createStore,reconcile} from 'solid-js/store';
    import {v2Host} from './src/host.ts';
    for (const original of [{type:'home'}, {type:'session',sessionID:'ses_original'}]) {
      const [route,setRoute] = createStore({...original});
      const host = v2Host({ui:{router:{current:()=>route,navigate:r=>setRoute(reconcile(r))}}});
      for (let i=0;i<2;i++) {
        const back = host.current();
        host.navigate('mouth-frustration');
        back.restore();
        assert.deepEqual({...route}, original);
      }
    }
  `));
});

test("configured host exit shortcuts work while Mouth's mode is active", { skip: !supported }, () => {
  assert.doesNotThrow(() => run(`
    import assert from 'node:assert/strict';
    import {createTestKeymap} from '@opentui/keymap/testing';
    import {v2Host} from './src/host.ts';
    const h=createTestKeymap({defaultKeys:true});
    const disposers=[];
    let exits=0;
    const get=id=>id==='app.exit'?[{key:'ctrl+x',cmd:'app.exit'}]:[];
    h.keymap.registerLayerFields({mode(value,ctx){ctx.require('opencode.mode',value)}});
    h.keymap.registerLayer({commands:[{name:'app.exit',run:()=>exits++}]});
    h.keymap.registerLayer({mode:'base',bindings:get('app.exit')});
    const context={ui:{slot(claim){claim.render();return()=>disposers.forEach(d=>d())}},keymap:{layer(input){
      const {mode,commands=[],bindings=[]}=input();
      disposers.push(h.keymap.registerLayer({...(mode==='global'?{}:{mode}),
        commands:commands.map(({id,run,...rest})=>({...rest,name:id,run})),
        bindings:bindings.flatMap(get)}));
    }}};
    const unregister=v2Host(context).commands('mouth-frustration','mouth.frustration',()=>{},[],{id:'mouth.frustration.open',title:'Mouth: frustration dashboard',description:'Judge how annoyed your messages sound',slash:'frustration'});
    try {
      h.keymap.setData('opencode.mode','base');h.host.press('x',{ctrl:true});assert.equal(exits,1);
      h.keymap.setData('opencode.mode','mouth.frustration');h.host.press('x',{ctrl:true});assert.equal(exits,2);
      unregister();h.host.press('x',{ctrl:true});assert.equal(exits,2);
      h.keymap.setData('opencode.mode','base');h.host.press('x',{ctrl:true});assert.equal(exits,3);
    } finally {h.cleanup()}
  `));
});

test("v2 judge sends the system prompt and forwards the model and signal", { skip: !supported }, () => {
  assert.doesNotThrow(() => run(`
    import assert from 'node:assert/strict';
    import {v2Host} from './src/host.ts';
    import {JUDGE_SYSTEM_PROMPT} from './src/judge.ts';
    let seen;
    const controller = new AbortController();
    const context = {
      options: {},
      theme: {},
      client: {
        generate: {
          text: async (input, requestOptions) => {
            seen = {input, requestOptions};
            return {text: '{"annoyed":2,"target":"assistant"}'};
          },
        },
      },
    };
    const main = async () => {
      const host = v2Host(context);
      const reply = await host.judge({model:{providerID:'test',modelID:'judge'},prompt:'hello',signal:controller.signal});
      assert.equal(reply, '{"annoyed":2,"target":"assistant"}');
      assert.deepEqual(seen.input, {
        prompt: JUDGE_SYSTEM_PROMPT + '\\n\\nhello',
        model: {id: 'judge', providerID: 'test'},
      });
      assert.equal(seen.requestOptions.signal, controller.signal);
    };
    main().catch((error) => { console.error(error); process.exit(1); });
  `));
});
