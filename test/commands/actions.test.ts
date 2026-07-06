/**
 * Unit tests for lib/commands/actions.ts mouse pointer handling.
 *
 * Regression guard for issue #84: in v1.4.1 each pointerDown/pointerUp attached
 * input and toggled the foreground lock timeout on its own, which spaced the two
 * presses of a double-click so far apart that it stopped registering. The gesture
 * must attach input at most once and reuse it for every press.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMousePointerActionSequence } from '../../lib/commands/actions';
import {
    mouseDown,
    mouseUp,
    getHwndByPoint,
    attachForegroundInput,
    detachForegroundInput,
} from '../../lib/winapi/user32';

vi.mock('../../lib/winapi/user32', () => ({
    mouseDown: vi.fn(),
    mouseUp: vi.fn(),
    mouseScroll: vi.fn(),
    mouseMoveAbsolute: vi.fn().mockResolvedValue(undefined),
    mouseMoveRelative: vi.fn().mockResolvedValue(undefined),
    withAttachedInput: vi.fn(async (_hwnd: unknown, fn: () => Promise<void>) => { await fn(); }),
    getHwndByPoint: vi.fn(),
    attachForegroundInput: vi.fn(),
    detachForegroundInput: vi.fn(),
}));

const makeDriver = () => ({ handleMouseMoveAction: vi.fn().mockResolvedValue(undefined) }) as any;

describe('handleMousePointerActionSequence', () => {
    beforeEach(() => vi.clearAllMocks());

    it('attaches input once for a double-click instead of once per press (issue #84)', async () => {
        (getHwndByPoint as any).mockReturnValue(0xABC);
        (attachForegroundInput as any).mockReturnValue({ attached: true });

        const driver = makeDriver();
        const seq = {
            type: 'pointer',
            id: 'default mouse',
            parameters: { pointerType: 'mouse' },
            actions: [
                { type: 'pointerMove', duration: 0, x: 10, y: 20, origin: 'viewport' },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerUp', button: 0 },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerUp', button: 0 },
            ],
        };

        await handleMousePointerActionSequence.call(driver, seq, { x: 0, y: 0 });

        // Attach/activate happens exactly once, using the window under the pointer.
        expect(attachForegroundInput).toHaveBeenCalledTimes(1);
        expect(getHwndByPoint).toHaveBeenCalledWith(10, 20);
        // Both presses of the double-click go through.
        expect(mouseDown).toHaveBeenCalledTimes(2);
        expect(mouseUp).toHaveBeenCalledTimes(2);
        // And input is always released.
        expect(detachForegroundInput).toHaveBeenCalledTimes(1);
    });

    it('releases the attached input even when a press throws', async () => {
        (getHwndByPoint as any).mockReturnValue(0xABC);
        (attachForegroundInput as any).mockReturnValue({ attached: true });
        (mouseDown as any).mockImplementationOnce(() => { throw new Error('boom'); });

        const driver = makeDriver();
        const seq = {
            actions: [
                { type: 'pointerMove', duration: 0, x: 5, y: 5, origin: 'viewport' },
                { type: 'pointerDown', button: 0 },
            ],
        };

        await expect(handleMousePointerActionSequence.call(driver, seq, { x: 0, y: 0 })).rejects.toThrow('boom');
        expect(detachForegroundInput).toHaveBeenCalledTimes(1);
    });
});
