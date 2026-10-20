import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTrustedCloudConfigs,trustedCloudConfigs} from './worker/cloud-execution-policy.mjs';
const config={environmentConfigId:'workspace_fixture~asenvcfg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',executorType:'codex_cloud',ownerId:'subject_owner_fixture',projectId:'example_project',taskId:'task_parent_fixture',sourceMessageId:'source_parent_fixture'};
const resolve=value=>resolveTrustedCloudConfigs({CLOUD_EXECUTION_CONFIGS_JSON:JSON.stringify(value)});
test('server cloud policy is closed without valid fully scoped configuration',()=>{
 assert.deepEqual(trustedCloudConfigs,[]);
 for(const env of [undefined,{}, {CLOUD_EXECUTION_CONFIGS_JSON:'invalid'},{CLOUD_EXECUTION_CONFIGS_JSON:'x'.repeat(32769)}])assert.deepEqual(resolveTrustedCloudConfigs(env),[]);
 for(const value of [null,{},[null],[[]],Array(17).fill(config),[config,config],[{...config,executorType:'desktop'}],[{...config,unknown:'injection'}],[{...config,ownerId:'*'}],[{...config,environmentConfigId:'bad~config'}]])assert.deepEqual(resolve(value),[]);
 for(const key of Object.keys(config)){const incomplete={...config};delete incomplete[key];assert.deepEqual(resolve([incomplete]),[])}
 for(const key of ['ownerId','projectId','taskId','sourceMessageId'])assert.deepEqual(resolve([{...config,[key]:''}]),[]);
});
test('server policy copies and freezes complete scope; request data cannot populate it',()=>{
 const rows=resolve([config]);assert.deepEqual(rows,[config]);assert.ok(Object.isFrozen(rows));assert.ok(Object.isFrozen(rows[0]));
 assert.throws(()=>{rows[0].ownerId='another_owner'},TypeError);
 assert.deepEqual(resolveTrustedCloudConfigs({body:{CLOUD_EXECUTION_CONFIGS_JSON:JSON.stringify([config])}}),[]);
 assert.deepEqual(resolveTrustedCloudConfigs({CLOUD_EXECUTION_CONFIGS_JSON:[config]}),[]);
});
