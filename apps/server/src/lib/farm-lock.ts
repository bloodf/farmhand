/** One farm mutation at a time inside this process. The helper takes a file lock on top of this. */
export class FarmLock {
  private holder: string | null = null;

  get busy() {
    return this.holder;
  }

  /** Returns a release function, or null when another operation holds the lock. */
  tryAcquire(label: string): (() => void) | null {
    if (this.holder) return null;
    this.holder = label;
    return () => {
      this.holder = null;
    };
  }
}
