export const quotaRowLayout = Object.freeze({
  width: '100%',
  flexDirection: 'row',
  justifyContent: 'flex-end',
});

export const quotaControlLayout = Object.freeze({
  width: 'auto',
  focusable: true,
});

export function createQuotaControlInteraction({
  toggle,
  hovered,
  pressed,
  focused,
  setHovered,
  setPressed,
  setFocused,
  theme,
  leftButton = 0,
}) {
  return {
    background() {
      if (pressed()) return theme.backgroundMenu;
      if (focused()) return theme.backgroundPanel;
      if (hovered()) return theme.backgroundElement;
      return undefined;
    },
    onMouseOver() {
      setHovered(true);
    },
    onMouseOut() {
      setHovered(false);
      setPressed(false);
    },
    onFocus() {
      setFocused(true);
    },
    onBlur() {
      setFocused(false);
    },
    onMouseDown(event) {
      if (event.button === leftButton) setPressed(true);
    },
    onMouseUp(event) {
      const activate = pressed() && event.button === leftButton;
      setPressed(false);
      if (activate) toggle();
    },
  };
}
