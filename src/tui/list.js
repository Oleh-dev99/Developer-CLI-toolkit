import { pad } from "./screen.js";

// A list for a panel of toolsmith ui. It keeps track of the selected item and
// of which part of the list is in view, scrolling to keep the selection in
// view when the list is taller than the panel. It can be filtered, and draws
// itself, with a message when there's nothing to show.
//
// `empty` is the message for no items, or a function that gives it.
//
// `items` can be anything: `label(item)` gives the text that's shown and that
// the filter looks in. When it's shown, `label` also gets the columns there's
// room for, so that it can leave out what wouldn't fit. Items count as the
// same when `key(item)` is (by default, the item itself), for keeping the
// selection when the items are replaced. A list that isn't `selectable` has no
// selection, and moving scrolls it instead, as for text to read; `style(item)`
// can then name a paint function for an item's row, like "bold".
export function createList(items = [], { label = String, empty = "Nothing here", selectable = true, style = () => undefined, key = (item) => item } = {}) {
  let filter = "";
  let shown = items; // the items that match the filter
  let selected = 0; // index in `shown`
  let top = 0; // index in `shown` of the first row in view
  let height = 1; // rows in view, as of the last render()

  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const lastTop = () => Math.max(0, shown.length - height);

  function move(step) {
    if (selectable) {
      selected = clamp(selected + step, 0, Math.max(0, shown.length - 1));
    } else {
      top = clamp(top + step, 0, lastTop());
    }
  }

  return {
    get filter() {
      return filter;
    },

    // Shows only the items whose label has `text` in it, in any case. The
    // selection stays on the same item when it still matches.
    setFilter(text) {
      const before = shown[selected];
      filter = text;
      const wanted = text.toLowerCase();
      shown = wanted ? items.filter((item) => label(item).toLowerCase().includes(wanted)) : items;
      selected = Math.max(0, shown.indexOf(before));
      top = 0;
    },

    // Replaces the items, keeping the filter, and the selection: on the same
    // item when it's still there, or else in the same place.
    setItems(newItems) {
      items = newItems;
      const before = shown[selected];
      const wanted = filter.toLowerCase();
      shown = wanted ? items.filter((item) => label(item).toLowerCase().includes(wanted)) : items;
      const same = before === undefined ? -1 : shown.findIndex((item) => key(item) === key(before));
      selected = same >= 0 ? same : Math.max(0, Math.min(selected, shown.length - 1));
    },

    // Whether the end of the list is in view, as of the last render(): for
    // output that should follow new lines only while it's scrolled down.
    isAtEnd: () => (selectable ? selected >= shown.length - 1 : top >= lastTop()),

    move,
    page: (direction) => move(direction * Math.max(1, height - 1)),
    first: () => move(-Infinity),
    last: () => move(Infinity),

    // The selected item, or undefined when there's none.
    selected: () => (selectable ? shown[selected] : undefined),
    count: () => shown.length,

    // Where the list is, for a header: "3/24" for the selected item, or
    // "1-6/34" for the rows in view of a list that only scrolls.
    position() {
      if (shown.length === 0) {
        return "";
      }
      return selectable ? `${selected + 1}/${shown.length}` : `${top + 1}-${Math.min(top + height, shown.length)}/${shown.length}`;
    },

    // `rows` strings, each `width` columns wide. In a focused list, the
    // selected row is drawn inverse; in any list, it starts with ">".
    render(width, rows, { focused = false, paint = { bar: (text) => text } } = {}) {
      height = Math.max(1, rows);
      if (shown.length === 0) {
        const message = filter ? `No match for "${filter}"` : typeof empty === "function" ? empty() : empty;
        return Array.from({ length: rows }, (_, row) => pad(row === 0 ? `  ${message}` : "", width));
      }
      if (selectable) {
        top = clamp(top, selected - height + 1, selected);
      }
      top = clamp(top, 0, lastTop());
      return Array.from({ length: rows }, (_, row) => {
        const index = top + row;
        if (index >= shown.length) {
          return pad("", width);
        }
        const item = shown[index];
        if (!selectable) {
          const line = pad(label(item, width), width);
          const painter = paint[style(item)];
          return painter ? painter(line) : line;
        }
        const isSelected = index === selected;
        const line = pad(`${isSelected ? ">" : " "} ${label(item, width - 2)}`, width);
        return isSelected && focused ? paint.bar(line) : line;
      });
    },
  };
}
