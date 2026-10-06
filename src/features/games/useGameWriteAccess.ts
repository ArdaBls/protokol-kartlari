import { useCallback, useEffect, useRef } from 'react'
import { useAuth } from '../../auth/useAuth'
import { getDbModeState, useDbMode } from '../../lib/dbMode'
import { isApprovedRole } from '../../lib/roles'

export interface GameWriteContext { uid: string; isTestMode: boolean }

/** Recheck at transaction retries as well as at the initial click. */
export function useGameWriteAccess() {
  const { state } = useAuth()
  const mode = useDbMode()
  const uid = state.status === 'ready' ? state.user.uid : ''
  const canWrite = mode.isReady && !mode.hasError && !mode.isReadOnly
    && state.status === 'ready' && isApprovedRole(state.role)
  const current = useRef({ uid, isTestMode: mode.isTestMode, canWrite })
  current.current = { uid, isTestMode: mode.isTestMode, canWrite }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const isCurrent = useCallback((context: GameWriteContext) => {
    const liveMode = getDbModeState()
    return mounted.current && current.current.canWrite && liveMode.isReady && !liveMode.hasError && !liveMode.isReadOnly
      && current.current.uid === context.uid && liveMode.isTestMode === context.isTestMode
  }, [])
  return { uid, isTestMode: mode.isTestMode, canWrite, isCurrent }
}
