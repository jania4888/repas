export interface LayoutRouteData {
  hideLayout?: boolean;
  fullWidth?: boolean;
  /** Content column fills the viewport under the header (no page scroll). */
  fillPane?: boolean;
}

export interface LayoutRouteFlags {
  hideLayout: boolean;
  fullWidth: boolean;
  fillPane: boolean;
}

export const DEFAULT_LAYOUT_ROUTE_FLAGS: LayoutRouteFlags = {
  hideLayout: false,
  fullWidth: false,
  fillPane: false
};