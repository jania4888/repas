import { signal } from '@angular/core';
import { of } from 'rxjs';

import { PurchaseOrderListItem, PurchaseOrderStatus } from '@core/services/purchase-order.service';
import { PurchaseReceiptFormComponent } from './purchase-receipt-form.component';

function po(id: string, status: PurchaseOrderStatus | string): PurchaseOrderListItem {
  return {
    id,
    number: `BC-${id}`,
    status: status as PurchaseOrderStatus,
    statusDisplay: 'Statut',
    totalHT: 100
  } as PurchaseOrderListItem;
}

describe('PurchaseReceiptFormComponent — bons de commande éligibles', () => {
  function load(items: PurchaseOrderListItem[]): string[] {
    const component = Object.create(PurchaseReceiptFormComponent.prototype) as PurchaseReceiptFormComponent;
    const getPurchaseOrders = jasmine.createSpy('getPurchaseOrders')
      .and.returnValue(of({ success: true, data: { items, totalCount: items.length } }));
    Object.defineProperty(component, 'poService', { value: { getPurchaseOrders } });
    Object.defineProperty(component, 'purchaseOrderOptions', { value: signal<{ id: string; label: string }[]>([]) });

    (component as unknown as { loadEligiblePurchaseOrders(id: string): void }).loadEligiblePurchaseOrders('supplier-1');

    expect(getPurchaseOrders).toHaveBeenCalledOnceWith({ supplierId: 'supplier-1', pageSize: 100 });
    return component.purchaseOrderOptions().map(o => o.id);
  }

  it('garde les bons confirmés et partiellement reçus quand l\'API envoie le statut en texte', () => {
    expect(load([
      po('confirmed', 'Confirmed'),
      po('partial', 'PartiallyReceived'),
      po('camel', 'partiallyReceived'),
      po('draft', 'Draft'),
      po('received', 'Received'),
      po('cancelled', 'Cancelled'),
      po('invoiced', 'Invoiced'),
      po('unknown', 'SomethingElse')
    ])).toEqual(['confirmed', 'partial', 'camel']);
  });

  it('garde aussi les statuts numériques', () => {
    expect(load([
      po('confirmed', PurchaseOrderStatus.Confirmed),
      po('partial', PurchaseOrderStatus.PartiallyReceived),
      po('draft', PurchaseOrderStatus.Draft),
      po('received', PurchaseOrderStatus.Received)
    ])).toEqual(['confirmed', 'partial']);
  });
});
