// ----------------------------------------------------------------------------
// DatePicker — cross-platform wrapper around a date picker.
//
// This file is the DEFAULT (native) implementation. Metro's platform-specific
// extension resolution automatically picks `DatePicker.web.js` when bundling
// for the browser, so the native bundle never sees the HTML implementation and
// vice-versa.
//
// The wrapper keeps the prop surface used across the app:
//   <DatePicker value={date} mode="date" display="..." maximumDate={...}
//                minimumDate={...} onChange={(event, date) => ...} />
//
// `@react-native-community/datetimepicker` 9.x deprecated `onChange` in favour
// of `onValueChange`, `onDismiss` and `onNeutralButtonPress`. Call sites still
// use the single `(event, date)` callback with `event.type` of 'set' or
// 'dismissed', so this wrapper translates the new handlers back into that
// shape. That keeps every call site unchanged and avoids the deprecation
// warning. The new handlers can also be passed directly and take precedence.
// ----------------------------------------------------------------------------

import RNDateTimePicker from '@react-native-community/datetimepicker';

function eventFor(type, value, source) {
  return {
    type,
    nativeEvent: source?.nativeEvent ?? {
      timestamp: value instanceof Date ? value.getTime() : Date.now(),
      utcOffset: 0,
    },
  };
}

export default function DatePicker({
  onChange,
  onValueChange,
  onDismiss,
  onNeutralButtonPress,
  value,
  ...rest
}) {
  return (
    <RNDateTimePicker
      {...rest}
      value={value}
      onValueChange={
        onValueChange ?? (onChange
          ? (event, date) => onChange(eventFor('set', date, event), date)
          : undefined)
      }
      onDismiss={
        onDismiss ?? (onChange
          ? () => onChange(eventFor('dismissed', value), value)
          : undefined)
      }
      onNeutralButtonPress={
        onNeutralButtonPress ?? (onChange
          ? () => onChange(eventFor('neutralButtonPressed', value), value)
          : undefined)
      }
    />
  );
}
