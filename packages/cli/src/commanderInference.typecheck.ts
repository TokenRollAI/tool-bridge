import { Command } from 'commander'
import { collect, configureGlobalOpts, withGlobalOpts, withPageOpts } from './args'
import { withDeviceConnectionGlobalOpts } from './commands/connect'

type IsAny<T> = 0 extends (1 & T) ? true : false

function expectNotAny<T>(value: IsAny<T> extends true ? never : T): void {
  void value
}

function expectType<T>(value: T): void {
  void value
}

withPageOpts(withGlobalOpts(new Command('typecheck')))
  .argument('<path>')
  .option('--tag <value>', 'repeatable typecheck option', collect, [])
  .action((path, opts) => {
    expectNotAny<typeof opts>(opts)
    expectNotAny<typeof opts.json>(opts.json)
    expectNotAny<typeof opts.cursor>(opts.cursor)
    expectNotAny<typeof opts.tag>(opts.tag)
    expectType<string>(path)
    expectType<boolean>(opts.json)
    expectType<string | undefined>(opts.cursor)
    expectType<string[]>(opts.tag)
  })

withDeviceConnectionGlobalOpts(new Command('typecheck')).action((opts) => {
  expectNotAny<typeof opts>(opts)
  expectNotAny<typeof opts.baseUrl>(opts.baseUrl)
  expectType<boolean>(opts.json)
  expectType<string | undefined>(opts.baseUrl)
})

configureGlobalOpts(new Command('typecheck')).action((opts) => {
  expectNotAny<typeof opts>(opts)
  expectNotAny<typeof opts.timeout>(opts.timeout)
  expectType<boolean>(opts.json)
  expectType<string | undefined>(opts.timeout)
})
