/** Browser-only local preparation. No upload, provider, storage or image interpretation. */
export type NotePhoto={data:string;name:'halo-observation.png';width:number;height:number;bytes:number;metadataRemoved:true;format:'image/png'};
export const notePhotoCopy={
  label:'Private photo (optional)',
  instructions:'JPEG, PNG or WebP, up to 5 MB. A new PNG copy removes embedded camera and location metadata. Visible details can still identify a person or place.',
  unsupported:'Choose a JPEG, PNG or WebP image.',
  tooLarge:'Choose an image no larger than 5 MB.',
  unreadable:'This image could not be read. Choose another file.',
  dimensions:'This image is too large to process here. Choose one below 32 megapixels.',
  processing:'Preparing a private image copy...',
  consent:'I reviewed the image and want to keep this copy with my private note.',
  notUploaded:'Local processed copy. Nothing has been uploaded or sent to Luna.',
  exportConsent:'I reviewed the visible details and choose to download this photo.',
  exportScope:'Only the processed PNG is downloaded. The original file, its filename, camera/location metadata and your note text are excluded. Visible faces, signs or landmarks remain in the image.',
} as const;
/** The largest file the hosting platform lets through to the upload route (its request body limit is 4.5 MB, multipart overhead included). */
export const UPLOAD_MAX_BYTES=4*1024*1024;
/** What the private report upload accepts: the server stores JPEG, PNG and WebP only (B14), so a PDF is never offered. */
export const REPORT_FILE_TYPES=['image/jpeg','image/png','image/webp'] as const;
export const reportFileCopy={accept:REPORT_FILE_TYPES.join(','),intro:'A JPEG, PNG or WebP image of your report, up to 4 MB. Camera and location metadata are removed when it is stored. Reports may contain identifying details. They are not sent to a laboratory or Luna.',invalid:'Choose a nonempty JPEG, PNG or WebP image no larger than 4 MB. For a PDF report, save a page as an image first.'} as const;
export function reportFileError(type:string,bytes:number){return (REPORT_FILE_TYPES as readonly string[]).includes(type)&&Number.isFinite(bytes)&&bytes>0&&bytes<=UPLOAD_MAX_BYTES?null:reportFileCopy.invalid;}
export function photoInputError(type:string,bytes:number){return !['image/jpeg','image/png','image/webp'].includes(type)?notePhotoCopy.unsupported:!Number.isFinite(bytes)||bytes<=0?notePhotoCopy.unreadable:bytes>5*1024*1024?notePhotoCopy.tooLarge:null;}
export function photoHeaderMatches(type:string,bytes:Uint8Array){return type==='image/png'?bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b):type==='image/jpeg'?bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/webp'?bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP':false;}
export async function sanitizeNotePhoto(file:File,signal?:AbortSignal):Promise<NotePhoto>{
 const invalid=photoInputError(file.type,file.size);if(invalid)throw Error(invalid);
 const header=new Uint8Array(await file.slice(0,24).arrayBuffer());if(!photoHeaderMatches(file.type,header))throw Error(notePhotoCopy.unreadable);if(signal?.aborted)throw Error('Photo preparation cancelled.');
 // Reject oversized PNGs before handing compressed pixels to the browser decoder.
 if(file.type==='image/png'&&header.length>=24){const view=new DataView(header.buffer);if(view.getUint32(16)*view.getUint32(20)>32_000_000)throw Error(notePhotoCopy.dimensions);}
 const url=URL.createObjectURL(file);const img=new Image();
 try{
  await new Promise<void>((resolve,reject)=>{const cancel=()=>{img.src='';reject(Error('Photo preparation cancelled.'));};signal?.addEventListener('abort',cancel,{once:true});img.onload=()=>{signal?.removeEventListener('abort',cancel);resolve();};img.onerror=()=>{signal?.removeEventListener('abort',cancel);reject(Error(notePhotoCopy.unreadable));};img.src=url;});
  if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>32_000_000)throw Error(notePhotoCopy.dimensions);
  const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));const width=Math.max(1,Math.round(img.naturalWidth*scale)),height=Math.max(1,Math.round(img.naturalHeight*scale));const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw Error(notePhotoCopy.unreadable);ctx.drawImage(img,0,0,width,height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error(notePhotoCopy.unreadable)),'image/png'));canvas.width=0;canvas.height=0;if(signal?.aborted)throw Error('Photo preparation cancelled.');if(blob.size>UPLOAD_MAX_BYTES)throw Error('The processed copy is too large. Choose a smaller image.');
  const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error(notePhotoCopy.unreadable));reader.readAsDataURL(blob);});if(signal?.aborted)throw Error('Photo preparation cancelled.');
  return {data,name:'halo-observation.png',width,height,bytes:blob.size,metadataRemoved:true,format:'image/png'};
 }finally{img.onload=null;img.onerror=null;img.src='';URL.revokeObjectURL(url);}
}
