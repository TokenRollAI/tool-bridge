/**
 * Keep `commander` as the sole runtime dependency while using the official
 * inference-only declarations for command arguments and options.
 */
declare module 'commander' {
  export * from '@commander-js/extra-typings'
}
