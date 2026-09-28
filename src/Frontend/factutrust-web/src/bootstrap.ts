import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

export function bootstrap(): Promise<unknown> {
  return bootstrapApplication(AppComponent, appConfig);
}
