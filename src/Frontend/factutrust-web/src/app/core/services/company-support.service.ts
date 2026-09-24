import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';
import { ApiResponse } from './auth.service';

export type CompanySupportCategory = 'Question' | 'Proposal' | 'Complaint' | 'Reply';
export type CompanySupportAuthorSide = 'Company' | 'Platform';

export interface CompanySupportAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface CompanySupportMessage {
  id: string;
  conversationId: string;
  authorSide: CompanySupportAuthorSide;
  authorDisplayName: string;
  category: CompanySupportCategory;
  body: string;
  sentAt: string;
  attachments: CompanySupportAttachment[];
}

export interface CompanySupportBootstrap {
  conversationId: string | null;
  messages: CompanySupportMessage[];
  lastReadAt: string | null;
  unreadCount: number;
}

@Injectable({ providedIn: 'root' })
export class CompanySupportService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/company-support`;

  bootstrap(): Observable<ApiResponse<CompanySupportBootstrap>> {
    return this.http.get<ApiResponse<CompanySupportBootstrap>>(`${this.baseUrl}/bootstrap`);
  }

  messagesAfter(after: string): Observable<ApiResponse<CompanySupportMessage[]>> {
    return this.http.get<ApiResponse<CompanySupportMessage[]>>(`${this.baseUrl}/messages`, {
      params: { after }
    });
  }

  unreadCount(context?: HttpContext): Observable<ApiResponse<number>> {
    return this.http.get<ApiResponse<number>>(`${this.baseUrl}/unread-count`, { context });
  }

  post(category: CompanySupportCategory, body: string, clientRequestId: string, files: File[]): Observable<ApiResponse<CompanySupportMessage>> {
    const form = new FormData();
    form.append('category', category);
    form.append('body', body);
    form.append('clientRequestId', clientRequestId);
    for (const file of files) {
      form.append('files', file, file.name);
    }
    return this.http.post<ApiResponse<CompanySupportMessage>>(`${this.baseUrl}/messages`, form);
  }

  markRead(readAt?: string): Observable<ApiResponse<unknown>> {
    const params = readAt ? { readAt } : undefined;
    return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/read`, {}, { params });
  }

  download(id: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/attachments/${id}`, { responseType: 'blob' });
  }
}
