// The one place that uses real time: a countdown for timed decisions.

export class Countdown {
  private handle: ReturnType<typeof setInterval> | null = null;
  private deadline = 0;

  /** Start (or restart) a countdown; onTick gets the seconds left, onExpire fires once. */
  start(seconds: number, onTick: (left: number) => void, onExpire: () => void): void {
    this.stop();
    this.deadline = Date.now() + seconds * 1000;
    onTick(seconds);
    this.handle = setInterval(() => {
      const left = (this.deadline - Date.now()) / 1000;
      if (left <= 0) {
        this.stop();
        onExpire();
      } else {
        onTick(left);
      }
    }, 250);
  }

  stop(): void {
    if (this.handle !== null) clearInterval(this.handle);
    this.handle = null;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  /** Seconds left, or null when not running. */
  get left(): number | null {
    return this.running ? Math.max(0, (this.deadline - Date.now()) / 1000) : null;
  }
}
