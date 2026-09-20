import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { StudioRecordRedirectComponent } from './studio-record-redirect.component';

describe('StudioRecordRedirectComponent', () => {
  it('redirige vers /studio/d/:key/:id/edit en conservant ?instance= (replaceUrl)', () => {
    TestBed.configureTestingModule({
      imports: [StudioRecordRedirectComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ key: 'clients', id: 'r1' }),
              queryParamMap: convertToParamMap({ instance: 'i1' })
            }
          }
        }
      ]
    });
    const router = TestBed.inject(Router);
    const navigateSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);

    TestBed.createComponent(StudioRecordRedirectComponent);

    expect(navigateSpy).toHaveBeenCalledWith('/studio/d/clients/r1/edit?instance=i1', { replaceUrl: true });
  });
});
