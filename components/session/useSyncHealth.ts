import { useSyncExternalStore } from 'react';
import { syncService, type SyncHealth } from '../../services/syncService';

/**
 * The sync health `syncService` reports, for a component that renders it. The
 * not-saved banner and the header chip both read it here, so they cannot
 * disagree about whether this client is being heard. They did once (review
 * finding G on the incident ISS branch): the banner said nothing was being
 * saved while the chip above it still pulsed a green "Live".
 *
 * Read from the service rather than passed down, so neither session screen can
 * show it on a different rule.
 */

// Module-level so useSyncExternalStore keeps one subscription for the life of
// the component instead of resubscribing on every render.
const subscribe = (onChange: () => void) => syncService.onSyncHealth(() => onChange());
const getHealth = () => syncService.getSyncHealth();

export const useSyncHealth = (): SyncHealth => useSyncExternalStore(subscribe, getHealth);
