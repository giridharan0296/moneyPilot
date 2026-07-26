// ----------------------------------------------------------------------------
// DatePicker — cross-platform wrapper around a date picker.
//
// This file is the DEFAULT (native) implementation. It simply re-exports
// `@react-native-community/datetimepicker` so existing call sites continue
// to work verbatim. Metro's platform-specific extension resolution will
// automatically pick `DatePicker.web.js` when bundling for the browser, so
// the native bundle never sees the HTML implementation and vice-versa.
//
// The wrapper preserves the exact prop surface used across the app:
//   <DatePicker value={date} mode="date" display="..." maximumDate={...}
//                minimumDate={...} onChange={(event, date) => ...} />
//
// This keeps the diff at each call site to a one-line import change.
// ----------------------------------------------------------------------------

import RNDateTimePicker from '@react-native-community/datetimepicker';

export default RNDateTimePicker;
