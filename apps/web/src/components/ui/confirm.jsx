/** @import { ReactNode } from 'react' */
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Button } from './button';
import { Dialog } from './overlay';

/**
 * @typedef {Object} ConfirmOptions
 * @property {string} title
 * @property {ReactNode} [body]
 * @property {string} confirmLabel
 * @property {boolean} [danger]
 */
const Ctx = createContext(/** @type {(o: ConfirmOptions) => Promise<boolean>} */ (async () => false));

/**
 * Accessible replacement for window.confirm(), rendered with the app's dialog.
 * @param {{ children: ReactNode }} props
 */
export function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState(/** @type {ConfirmOptions | null} */ (null));
  const resolver = useRef(/** @type {((v: boolean) => void) | null} */ (null));
  const confirm = useCallback(
    /** @param {ConfirmOptions} o */ (o) => {
      setOpts(o);
      return /** @type {Promise<boolean>} */ (
        new Promise((resolve) => {
          resolver.current = resolve;
        })
      );
    },
    [],
  );
  /** @param {boolean} v */
  const close = (v) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };
  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Dialog
        open={!!opts}
        onOpenChange={(o) => !o && close(false)}
        title={opts?.title ?? ''}
        description={opts?.body}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={opts?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {opts?.confirmLabel}
            </Button>
          </>
        }
      >
        <span className="sr-only">Confirm the action</span>
      </Dialog>
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
