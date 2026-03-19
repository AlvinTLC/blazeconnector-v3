/**
 * Billing Service - BlazeConnector v3
 * Multi-system customer lookup and billing operations
 */

import { getIntegrationService, httpGet, httpPost } from './integrations';
import { log } from '../core/logger';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

export const CustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  status: z.enum(['active', 'suspended', 'inactive']).optional(),
  balance: z.number().optional(),
  plan: z.string().optional(),
  customFields: z.record(z.unknown()).optional(),
});

export type Customer = z.infer<typeof CustomerSchema>;

export const InvoiceSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  amount: z.number(),
  currency: z.string().default('DOP'),
  status: z.enum(['pending', 'paid', 'overdue', 'cancelled']),
  dueDate: z.string().optional(),
  paidDate: z.string().optional(),
  description: z.string().optional(),
});

export type Invoice = z.infer<typeof InvoiceSchema>;

// ============================================================================
// Billing Service
// ============================================================================

export class BillingService {
  private integrationService = getIntegrationService();
  
  /**
   * Get customer by ID or phone from any configured billing system
   */
  async getCustomer(
    clientId: string,
    identifier: string,
    system?: string
  ): Promise<Customer | null> {
    const systems = system ? [system] : ['mikrowisp', 'wisphub', 'oficable'];
    
    for (const sys of systems) {
      try {
        const customer = await this.getCustomerFromSystem(clientId, identifier, sys);
        if (customer) return customer;
      } catch (err) {
        log.integrations.debug({ err, system: sys }, 'Failed to get customer from system');
      }
    }
    
    return null;
  }
  
  /**
   * Get customer from a specific billing system
   */
  private async getCustomerFromSystem(
    clientId: string,
    identifier: string,
    system: string
  ): Promise<Customer | null> {
    switch (system) {
      case 'mikrowisp':
        return this.getMikrowispCustomer(clientId, identifier);
      case 'wisphub':
        return this.getWisphubCustomer(clientId, identifier);
      case 'oficable':
        return this.getOficableCustomer(clientId, identifier);
      default:
        return null;
    }
  }
  
  // ========================================================================
  // MikroWisp Integration
  // ========================================================================
  
  private async getMikrowispCustomer(clientId: string, identifier: string): Promise<Customer | null> {
    const config = await this.integrationService.getIntegration<{
      apiUrl: string;
      apiKey: string;
    }>(clientId, 'mikrowisp');
    
    if (!config) return null;
    
    const url = new URL(`${config.apiUrl}/api/v1/clientes/${identifier}`);
    
    const response = await httpGet<{
      success: boolean;
      data?: {
        id: string;
        nombre: string;
        email?: string;
        telefono?: string;
        direccion?: string;
        estado?: string;
        saldo?: number;
        plan?: string;
      };
    }>(url.toString(), {
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      timeout: 10000,
    });
    
    if (!response.success || !response.data) return null;
    
    return {
      id: response.data.id,
      name: response.data.nombre,
      email: response.data.email,
      phone: response.data.telefono,
      address: response.data.direccion,
      status: response.data.estado === 'activo' ? 'active' : 
              response.data.estado === 'suspendido' ? 'suspended' : 'inactive',
      balance: response.data.saldo,
      plan: response.data.plan,
    };
  }
  
  // ========================================================================
  // WispHub Integration
  // ========================================================================
  
  private async getWisphubCustomer(clientId: string, identifier: string): Promise<Customer | null> {
    const config = await this.integrationService.getIntegration<{
      apiUrl: string;
      apiKey: string;
    }>(clientId, 'wisphub');
    
    if (!config) return null;
    
    const url = new URL(`${config.apiUrl}/api/clientes/${identifier}`);
    
    const response = await httpGet<{
      status: boolean;
      data?: {
        id: string;
        nombre: string;
        email?: string;
        telefono?: string;
        direccion?: string;
        estado?: string;
        saldo_pendiente?: number;
        plan?: { nombre?: string };
      };
    }>(url.toString(), {
      headers: { 'X-API-Key': config.apiKey },
      timeout: 10000,
    });
    
    if (!response.status || !response.data) return null;
    
    return {
      id: response.data.id,
      name: response.data.nombre,
      email: response.data.email,
      phone: response.data.telefono,
      address: response.data.direccion,
      status: response.data.estado === 'activo' ? 'active' : 
              response.data.estado === 'suspendido' ? 'suspended' : 'inactive',
      balance: response.data.saldo_pendiente,
      plan: response.data.plan?.nombre,
    };
  }
  
  // ========================================================================
  // OfiCable Integration
  // ========================================================================
  
  private async getOficableCustomer(clientId: string, identifier: string): Promise<Customer | null> {
    const config = await this.integrationService.getIntegration<{
      apiUrl: string;
      apiKey: string;
    }>(clientId, 'oficable');
    
    if (!config) return null;
    
    // OfiCable can search by phone or ID
    const url = new URL(`${config.apiUrl}/api/cliente`);
    url.searchParams.set('telefono', identifier);
    
    const response = await httpGet<{
      success: boolean;
      cliente?: {
        id: string;
        nombre: string;
        email?: string;
        telefono?: string;
        direccion?: string;
        estado?: string;
        saldo?: number;
        plan?: string;
      };
    }>(url.toString(), {
      headers: { 'X-API-Key': config.apiKey },
      timeout: 10000,
    });
    
    if (!response.success || !response.cliente) return null;
    
    return {
      id: response.cliente.id,
      name: response.cliente.nombre,
      email: response.cliente.email,
      phone: response.cliente.telefono,
      address: response.cliente.direccion,
      status: response.cliente.estado === 'activo' ? 'active' : 
              response.cliente.estado === 'suspendido' ? 'suspended' : 'inactive',
      balance: response.cliente.saldo,
      plan: response.cliente.plan,
    };
  }
  
  /**
   * Get pending invoices for a customer
   */
  async getPendingInvoices(
    clientId: string,
    customerId: string,
    system?: string
  ): Promise<Invoice[]> {
    // Implementation would be similar to getCustomer, querying each system
    // This is a placeholder for now
    return [];
  }
  
  /**
   * Apply payment to billing system
   */
  async applyPayment(
    clientId: string,
    customerId: string,
    amount: number,
    reference: string,
    system?: string
  ): Promise<{ success: boolean; transactionId?: string; error?: string }> {
    // Implementation would apply payment to the billing system
    // This is a placeholder for now
    return { success: false, error: 'Not implemented' };
  }
}

// Singleton
let _service: BillingService | null = null;

export function getBillingService(): BillingService {
  if (!_service) {
    _service = new BillingService();
  }
  return _service;
}
