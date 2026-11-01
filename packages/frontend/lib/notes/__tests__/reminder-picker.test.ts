import React from 'react';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defined } from '@/lib/__tests__/defined';

const { create, act } = createRequire(import.meta.url)('react-test-renderer');
vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('@oxy.so/bloom/button', () => ({ Button: 'Button' }));
vi.mock('@oxy.so/bloom/date-picker', () => ({ Calendar: 'Calendar', TimeField: 'TimeField' }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: 'Dialog',
  DialogContent: 'DialogContent',
  DialogHeader: 'DialogHeader',
  DialogTitle: 'DialogTitle',
}));
vi.mock('@/components/ui/text', () => ({ Text: 'Text' }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { ReminderPickerDialog } from '@/components/notes/reminder-picker-dialog';

let root: ReturnType<typeof create> | undefined;
let previousTimezone: string | undefined;
beforeEach(() => {
  previousTimezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2027-03-01T12:00:00.000Z'));
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  if (previousTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimezone;
});

describe('reminder picker', () => {
  it('does not rewrite the later occurrence when an existing repeated time is unchanged', async () => {
    vi.setSystemTime(new Date('2027-11-01T12:00:00.000Z'));
    const onPick = vi.fn();
    const onOpenChange = vi.fn();
    await act(async () => {
      root = create(
        React.createElement(ReminderPickerDialog, {
          open: true,
          current: '2027-11-07T06:30:00.000Z',
          onPick,
          onOpenChange,
        }),
      );
    });
    const save = defined(root, 'rendered picker')
      .root.findAllByType('Button')
      .find(
        (button: { props: { children: unknown } }) => button.props.children === 'notes.setReminder',
      );
    expect(save?.props.disabled).toBe(false);
    await act(async () => save?.props.onPress());
    expect(onPick).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('allows keeping the later occurrence when the first has already passed', async () => {
    vi.setSystemTime(new Date('2027-11-07T05:45:00.000Z'));
    const onPick = vi.fn();
    await act(async () => {
      root = create(
        React.createElement(ReminderPickerDialog, {
          open: true,
          current: '2027-11-07T06:30:00.000Z',
          onPick,
          onOpenChange: vi.fn(),
        }),
      );
    });
    const save = defined(root, 'rendered picker')
      .root.findAllByType('Button')
      .find(
        (button: { props: { children: unknown } }) => button.props.children === 'notes.setReminder',
      );
    expect(save?.props.disabled).toBe(false);
    await act(async () => save?.props.onPress());
    expect(onPick).not.toHaveBeenCalled();
  });

  it('still saves a changed reminder time', async () => {
    vi.setSystemTime(new Date('2027-11-01T12:00:00.000Z'));
    const onPick = vi.fn();
    await act(async () => {
      root = create(
        React.createElement(ReminderPickerDialog, {
          open: true,
          current: '2027-11-07T06:30:00.000Z',
          onPick,
          onOpenChange: vi.fn(),
        }),
      );
    });
    await act(async () =>
      defined(root, 'rendered picker').root.findByType('TimeField').props.onChange('02:30'),
    );
    const save = defined(root, 'rendered picker')
      .root.findAllByType('Button')
      .find(
        (button: { props: { children: unknown } }) => button.props.children === 'notes.setReminder',
      );
    expect(save?.props.disabled).toBe(false);
    await act(async () => save?.props.onPress());
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick.mock.calls[0]?.[0].toISOString()).toBe('2027-11-07T07:30:00.000Z');
  });

  it('explains a skipped local time, prevents saving and accepts a valid replacement', async () => {
    const onPick = vi.fn();
    const onOpenChange = vi.fn();
    await act(async () => {
      root = create(
        React.createElement(ReminderPickerDialog, {
          open: true,
          current: null,
          onPick,
          onOpenChange,
        }),
      );
    });
    await act(async () => {
      defined(root, 'rendered picker')
        .root.findByType('Calendar')
        .props.onChange(new Date(2027, 2, 14));
      defined(root, 'rendered picker').root.findByType('TimeField').props.onChange('02:30');
    });
    const save = () =>
      defined(root, 'rendered picker')
        .root.findAllByType('Button')
        .find(
          (button: { props: { children: unknown } }) =>
            button.props.children === 'notes.setReminder',
        );
    expect(save()?.props.disabled).toBe(true);
    expect(
      defined(root, 'rendered picker').root.findByProps({ accessibilityRole: 'alert' }).props
        .children,
    ).toBe('notes.reminderInvalidTime');
    await act(async () => save()?.props.onPress());
    expect(onPick).not.toHaveBeenCalled();
    await act(async () =>
      defined(root, 'rendered picker').root.findByType('TimeField').props.onChange('03:30'),
    );
    expect(save()?.props.disabled).toBe(false);
    expect(
      defined(root, 'rendered picker').root.findAllByProps({ accessibilityRole: 'alert' }),
    ).toHaveLength(0);
    await act(async () => save()?.props.onPress());
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick.mock.calls[0]?.[0].toISOString()).toBe('2027-03-14T07:30:00.000Z');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
