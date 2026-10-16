/** Mechanical assembly: keep source documents intact and detect truncated handoffs. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const target='docs/product/HALO_BACKEND_WIRING_CURRENT.md';
const manifestPath='docs/product/HALO_BACKEND_WIRING_MANIFEST.json';
const audit=JSON.parse(fs.readFileSync('tmp/frontend-wiring-closeout/audit.json','utf8'));
const inventory=JSON.parse(fs.readFileSync('tmp/backend-handoff-wrap/inventory.json','utf8'));
const sources=[
 'docs/continuation/FRONTEND_WIRING_CLOSEOUT.md',
 'docs/continuation/FRONTEND_WIRING_VERIFICATION.md',
 'tmp/frontend-wiring-closeout/operations.md',
 'docs/continuation/FRONTEND_INTEGRATION_READY.md',
 'docs/continuation/HOME_ACCOUNT_PRODUCTION_INTEGRATION.md',
 'docs/continuation/EXPANDED_PRODUCTION_INTEGRATION.md',
 'docs/product/OCTOBER15_REDESIGN_BACKEND_DELTA.md',
 'docs/continuation/OCTOBER16_REDESIGN_IMPLEMENTATION.md',
 'docs/continuation/OCTOBER16_VISUAL_REFINEMENT.md',
 'components/expanded/HOMEPAGE_BACKEND_DELTA.md',
 'components/expanded/EXPLORE_BACKEND_DELTA.md',
 'components/expanded/MY_WEEK_REVIEW.md',
 'components/expanded/SETTINGS_ALERTS_REVIEW.md',
 'docs/foundation/WIREFRAME_COMPLETION_MATRIX.md',
 'docs/product/HALO_COMPLETE_BACKEND_HANDOFF.md',
 'docs/product/ai/HALO_BACKEND_WORKING_SPEC.md',
 'tmp/backend-handoff-wrap/interface-ledger.md',
 'tmp/backend-handoff-wrap/type-register.md',
 'tmp/backend-handoff-wrap/source-register.md',
];
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const entries=sources.map(source=>{const body=fs.readFileSync(source,'utf8').replace(/\r\n/g,'\n');return {source,body,bytes:Buffer.byteLength(body),sha256:hash(body)};});
const header=['# HALO: complete current backend wiring packet','',
 'Prepared October 16, 2026 for Vibhav. Download this whole file from branch `codex/october15-review-refinement`. GitHub may truncate its rendered preview because this packet intentionally includes the complete detailed requirements. Use Download raw file or clone the branch, not a chat excerpt.',
 '', '**Completion marker:** the final line must be `HALO-WIRING-PACKET-END`. The companion `HALO_BACKEND_WIRING_MANIFEST.json` records source hashes and packet size/hash. A copy ending at BE-032 is incomplete.',
 '', '**Read order and authority:** Part 1 (current closeout), Part 2 (verification), Part 3 (current operation audit), then current domain contracts and review deltas. Later historical sections preserve the full product baseline, not old branch/status statements. Current runtime contracts supersede older transport proposals; no scientific/privacy/source safeguard is weakened. Nothing in this file claims live backend or provider success.',
 '', 'Embedded documents retain their original prose, headings, source paths and relative links. Resolve a relative link against its named source document in the repository. Repeated appendix/control IDs are scoped to that document and audit date. The final three parts are the fresh current control/type/source inventory; older inventory is retained as historical evidence.',
 '', `Coverage: ${audit.featureCount} feature groups, 25 integration journeys, ${audit.requirementCount.toLocaleString('en-US')} named substantive baseline requirements, ${audit.operations.length} new runtime operations; ${inventory.totals.controls.toLocaleString('en-US')} current control declarations across ${inventory.totals.jsxFiles} JSX files. Static declarations are not a guarantee of runtime completeness.`,
 '', '## Included sources','', '| Part | Repository source | Normalized UTF-8 bytes | SHA-256 |','| --- | --- | ---: | --- |',
 ...entries.map((entry,index)=>`| ${index+1} | ${entry.source} | ${entry.bytes} | ${entry.sha256} |`),''];
const packet=header.join('\n')+'\n'+entries.map((entry,index)=>`\n---\n\n## Packet part ${index+1}: ${path.basename(entry.source)}\n\nSource: \`${entry.source}\`.\n\n<!-- HALO-SOURCE-BEGIN ${entry.source} -->\n${entry.body}\n<!-- HALO-SOURCE-END ${entry.source} -->\n`).join('')+'\n---\n\nAll included sources end above. No live service acceptance is implied.\n\nHALO-WIRING-PACKET-END\n';
const manifest={version:1,branch:'codex/october15-review-refinement',refs: audit.refs,counts:{features:audit.featureCount,journeys:25,requirements:audit.requirementCount,operations:audit.operations.length,...inventory.totals},sources:entries.map(({source,bytes,sha256})=>({source,bytes,sha256})),packet:{path:target,bytes:Buffer.byteLength(packet),sha256:hash(packet)}};
const failures=[];
if(audit.unknownOperations.length||audit.missingFeatures.length||audit.missingRequirementIds.length)failures.push('Operation or baseline coverage gaps');
for(let n=1;n<=25;n++)if(!new RegExp('^\\| INT'+String(n).padStart(2,'0')+' \\|','m').test(packet))failures.push(`Missing integration journey ${n}`);
for(const entry of entries)if(!packet.includes(entry.body))failures.push(`Incomplete source ${entry.source}`);
if(!packet.endsWith('HALO-WIRING-PACKET-END\n'))failures.push('Missing completion marker');
if([/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bsk-[A-Za-z0-9_-]{30,}\b/,/\bgh[pousr]_[0-9A-Za-z]{30,}\b/].some(pattern=>pattern.test(packet)))failures.push('Credential-like content requires inspection');
if(process.argv.includes('--verify')){
 if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==packet)failures.push('Packet differs from its current source documents; regenerate it');
 const saved=JSON.parse(fs.readFileSync(manifestPath,'utf8'));if(JSON.stringify(saved)!==JSON.stringify(manifest))failures.push('Manifest differs; regenerate it');
}else if(!failures.length){fs.writeFileSync(target,packet);fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');}
console.log(JSON.stringify({mode:process.argv.includes('--verify')?'verify':'assemble',sources:entries.length,...manifest.counts,...manifest.packet,passed:!failures.length,failures},null,2));
if(failures.length)process.exitCode=1;
