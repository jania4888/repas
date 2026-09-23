export interface MenuItem {
  label?: string;
  icon?: string;
  command?: () => void;
  routerLink?: string | string[];
  separator?: boolean;
  visible?: boolean;
  disabled?: boolean;
}
