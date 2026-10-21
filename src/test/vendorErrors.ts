import { VendorAPIError } from '@/lib/vendors/http'

/** Test helper: await a promise that must reject with a VendorAPIError, and return it. */
export async function expectVendorError(promise: Promise<unknown>): Promise<VendorAPIError> {
  try {
    await promise
  } catch (e) {
    if (e instanceof VendorAPIError) return e
    throw e
  }
  throw new Error('expected the promise to reject with a VendorAPIError')
}
