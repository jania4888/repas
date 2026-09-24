import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';
import type { ApiResponse } from '@core/models/api-response.model';

export interface PlatformSupportMessage {
  id: string;
  conversationId: string;
  authorSide: 'Company' | 'Platform' | number;
  authorDisplayName: string;
  category: 'Question' | 'Proposal' | 'Complaint' | 'Reply' | number;
  body: string;
  sentAt: string;
  attachments: { id: string; fileName: string; contentType: string; sizeBytes: number }[];
}

export interface PlatformSupportBootstrap {
  conversationId: string | null;
  messages: PlatformSupportMessage[];
  lastReadAt: string | null;
  unreadCount: number;
}

export interface PlatformSupportInboxItem {
  conversationId: string;
  companyTenantId: string;
  companyName: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageCategory: string | number | null;
  lastAuthorSide: string | number | null;
  unreadCount: number;
}

export interface PlatformSupportInbox {
  items: PlatformSupportInboxItem[];
  totalCount: number;
}

@Injectable({ providedIn: 'root' })
export class PlatformCompanySupportService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/platform/company-support`;

  inbox(): Observable<ApiResponse<PlatformSupportInbox>> {
    return this.http.get<ApiResponse<PlatformSupportInbox>>(`${this.base}/conversations`, {
      params: { page: 1, pageSize: 50 }
    });
  }

  unreadCount(): Observable<ApiResponse<number>> {
    return this.http.get<ApiResponse<number>>(`${this.base}/unread-count`);
  }

  thread(tenantId: string): Observable<ApiResponse<PlatformSupportBootstrap>> {
    return this.http.get<ApiResponse<PlatformSupportBootstrap>>(`${this.base}/conversations/${tenantId}`);
  }

  reply(tenantId: string, body: string, clientRequestId: string, files: File[]): Observable<ApiResponse<PlatformSupportMessage>> {
    const form = new FormData();
    form.append('body', body);
    form.append('clientRequestId', clientRequestId);
    for (const file of files) form.append('files', file, file.name);
    return this.http.post<ApiResponse<PlatformSupportMessage>>(`${this.base}/conversations/${tenantId}/messages`, form);
  }

  markRead(tenantId: string, readAt: string): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/conversations/${tenantId}/read`, {}, {
      params: { readAt }
    });
  }

  download(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/attachments/${id}`, { responseType: 'blob' });
  }
}
