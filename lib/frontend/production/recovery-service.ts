export type RecoveryStatus = {operationId:string;status:'pending'|'verified'|'expired'|'collision'|'failed'|'unknown';challengeId:string|null;expiresAt:string|null;restoreToken?:string;session?:{identityId:string;accessToken:string;refreshToken:string}};
export function validRecoveryStatus(value:unknown,operationId:string):value is RecoveryStatus{
 if(!value||typeof value!=='object')return false;const x=value as Record<string,unknown>;
 if(x.operationId!==operationId||!['pending','verified','expired','collision','failed','unknown'].includes(String(x.status))||!(x.challengeId===null||typeof x.challengeId==='string'&&x.challengeId.length>0&&x.challengeId.length<=500)||!(x.expiresAt===null||typeof x.expiresAt==='string'&&Number.isFinite(Date.parse(x.expiresAt))))return false;
 if(x.restoreToken!==undefined&&(typeof x.restoreToken!=='string'||!x.restoreToken||x.restoreToken.length>8192))return false;
 if(x.session!==undefined){if(!x.session||typeof x.session!=='object')return false;const s=x.session as Record<string,unknown>;if(!['identityId','accessToken','refreshToken'].every(key=>typeof s[key]==='string'&&s[key]!==''&&String(s[key]).length<=16000))return false;}
 return x.status!=='verified'||typeof x.restoreToken==='string'||x.session!==undefined;
}
