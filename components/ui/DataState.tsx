import type { ReactNode } from 'react';
import { copy } from '@/lib/frontend/copy';
import type { HaloDataStatus } from '@/lib/frontend/useHaloData';
import type { ErrorCode } from '@/lib/frontend/types';
import ErrorCallout from './ErrorCallout';

export default function DataState({status,error,errorMessage,loading,empty,children,retry}:{status:HaloDataStatus;error?:ErrorCode|null;errorMessage?:string;loading:ReactNode;empty?:ReactNode;children:ReactNode;retry?:()=>void}) {
  if(status==='loading')return <>{loading}</>;
  if(status==='error')return <ErrorCallout message={errorMessage ?? copy.errors[error??'generic']} retry={retry} />;
  if(status==='empty')return <>{empty??<p>{copy.common.empty}</p>}</>;
  return <>{children}</>;
}
