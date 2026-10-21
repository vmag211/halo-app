'use client';
import {RestoreAccessFlow} from './AccountWorkflows';
// The isolated provider remains above both owned and public review surfaces.
// Restoring an existing account requires a verified service response, never an email match.
export default function RecoveryFlowBoundary(){return <RestoreAccessFlow/>;}
