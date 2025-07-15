/**
 * Epic FHIR Tools
 * MCP tools for Epic FHIR integration - standalone server version
 */

import { EpicFHIRClient } from '../services/epic-fhir-client.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export class EpicFHIRTools {
  private client: EpicFHIRClient;

  constructor(client: EpicFHIRClient) {
    this.client = client;
  }

  // Tool 1: Search Patients
  createSearchPatientsTool(): Tool {
    return {
      name: 'epicSearchPatients',
      description: 'Search for in Epic FHIR by name, identifier, or other criteria',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Patient name to search for (first, last, or full name)',
            minLength: 2
          },
          identifier: {
            type: 'string',
            description: 'Patient identifier (MRN, SSN, etc.)'
          },
          birthdate: {
            type: 'string',
            description: 'Patient birth date in YYYY-MM-DD format'
          },
          gender: {
            type: 'string',
            enum: ['male', 'female', 'other', 'unknown'],
            description: 'Patient gender'
          },
          active: {
            type: 'boolean',
            description: 'Whether to include only active patients'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 10)',
            minimum: 1,
            maximum: 50
          }
        }
      }
    };
  }

// Add this debug code to your handleSearchPatients method in epic-fhir-tools.ts

// Update your handleSearchPatients method in epic-fhir-tools.ts

async handleSearchPatients(args: {
  name?: string;
  identifier?: string;
  birthdate?: string;
  gender?: string;
  active?: boolean;
  limit?: number;
}): Promise<any> {
  try {
    const searchParams: Record<string, string> = {};
    
    if (args.name) searchParams.name = args.name;
    if (args.identifier) searchParams.identifier = args.identifier;
    if (args.birthdate) searchParams.birthdate = args.birthdate;
    if (args.gender) searchParams.gender = args.gender;
    if (args.active !== undefined) searchParams.active = args.active.toString();
    
    // Set count limit (Epic supports this)
    searchParams._count = (args.limit || 10).toString();
    
    // REMOVE THIS LINE - Epic doesn't support _sort for Patient search
    // searchParams._sort = 'family';  // ❌ Remove this!

    console.log('🔍 Epic Search Parameters:', JSON.stringify(searchParams, null, 2));

    const response = await this.client.searchResource('Patient', searchParams);
    
    console.log('🔍 Full Epic Response:', JSON.stringify(response, null, 2));
    console.log('🔍 Response Type:', response.resourceType);
    console.log('🔍 Total Results:', response.total);
    console.log('🔍 Entry Count:', response.entry?.length || 0);
    
    // Check for Epic issues (OperationOutcome)
    if (response.entry && response.entry.length > 0) {
      const hasOperationOutcome = response.entry.some((entry: any) => 
        entry.resource?.resourceType === 'OperationOutcome'
      );
      
      if (hasOperationOutcome) {
        console.log('⚠️ Epic returned OperationOutcome - checking for actual patient data...');
        
        // Filter out OperationOutcome entries to find actual patients
        const patientEntries = response.entry.filter((entry: any) => 
          entry.resource?.resourceType === 'Patient'
        );
        
        if (patientEntries.length === 0) {
          console.log('❌ No actual patient data found, only OperationOutcome');
          
          // Extract issues for user feedback
          const issues = response.entry
            .filter((entry: any) => entry.resource?.resourceType === 'OperationOutcome')
            .flatMap((entry: any) => entry.resource?.issue || []);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: 'No patients found matching the search criteria',
                epicIssues: issues.map((issue: any) => ({
                  severity: issue.severity,
                  code: issue.code,
                  details: issue.details?.text,
                  diagnostics: issue.diagnostics
                })),
                searchParams,
                suggestion: 'Try searching with a different name or check spelling'
              }, null, 2)
            }]
          };
        }
        
        // Process actual patient entries
        response.entry = patientEntries;
      }
    }
    
    if (!response.entry || response.entry.length === 0 || response.total === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: 'No patients found matching the search criteria',
            patientsFound: 0,
            patients: [],
            searchParams,
            suggestion: 'Try searching for known test patients like "Camila Lopez" or "Jason Argonaut"'
          }, null, 2)
        }]
      };
    }

    console.log('✅ Processing Epic patient entries...');
    
    const patients = response.entry.map((entry: any, index: number) => {
      const patient = entry.resource;
      
      // Skip OperationOutcome entries
      if (patient.resourceType !== 'Patient') {
        return null;
      }
      
      console.log(`🔍 Processing patient ${index + 1}:`, {
        id: patient.id,
        name: patient.name,
        active: patient.active
      });
      
      return {
        id: patient.id,
        name: this.formatPatientName(patient.name),
        birthDate: patient.birthDate,
        gender: patient.gender,
        active: patient.active,
        mrn: this.extractMRN(patient.identifier),
        phone: this.extractPhone(patient.telecom),
        email: this.extractEmail(patient.telecom),
        address: this.formatAddress(patient.address)
      };
    }).filter(Boolean); // Remove null entries

    console.log('✅ Processed patients:', JSON.stringify(patients, null, 2));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          patientsFound: patients.length,
          patients,
          source: 'Epic FHIR',
          searchParams
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error('❌ Epic search error:', error);
    return this.handleError('searchPatients', error);
  }
}

  // Tool 2: Get Patient Details
  createGetPatientTool(): Tool {
    return {
      name: 'epicGetPatientDetails',
      description: 'Get detailed information for a specific patient by ID',
      inputSchema: {
        type: 'object',
        properties: {
          patientId: {
            type: 'string',
            description: 'FHIR Patient ID',
            minLength: 1
          }
        },
        required: ['patientId']
      }
    };
  }

  async handleGetPatient(args: { patientId: string }): Promise<any> {
    try {
      const patient = await this.client.getResource('Patient', args.patientId);
      
      const patientDetails = {
        id: patient.id,
        name: this.formatPatientName(patient.name),
        birthDate: patient.birthDate,
        gender: patient.gender,
        active: patient.active,
        mrn: this.extractMRN(patient.identifier),
        identifiers: patient.identifier,
        telecom: patient.telecom,
        phone: this.extractPhone(patient.telecom),
        email: this.extractEmail(patient.telecom),
        address: this.formatAddress(patient.address),
        maritalStatus: patient.maritalStatus?.text,
        communication: patient.communication,
        generalPractitioner: patient.generalPractitioner,
        managingOrganization: patient.managingOrganization?.display,
        meta: patient.meta
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            patient: patientDetails
          }, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError('getPatientDetails', error);
    }
  }

  // Tool 3: Get Patient Observations
  createGetObservationsTool(): Tool {
    return {
      name: 'epicGetPatientObservations',
      description: 'Get lab results, vitals, and other observations for a patient',
      inputSchema: {
        type: 'object',
        properties: {
          patientId: {
            type: 'string',
            description: 'FHIR Patient ID',
            minLength: 1
          },
          category: {
            type: 'string',
            enum: ['vital-signs', 'laboratory', 'imaging', 'procedure', 'survey', 'exam', 'therapy'],
            description: 'Observation category filter'
          },
          code: {
            type: 'string',
            description: 'Specific observation code (LOINC, SNOMED, etc.)'
          },
          date: {
            type: 'string',
            description: 'Date range in format YYYY-MM-DD or ge2023-01-01&le2023-12-31'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20)',
            minimum: 1,
            maximum: 100
          }
        },
        required: ['patientId']
      }
    };
  }

  async handleGetObservations(args: {
    patientId: string;
    category?: string;
    code?: string;
    date?: string;
    limit?: number;
  }): Promise<any> {
    try {
      const searchParams: Record<string, string> = {
        patient: args.patientId,
        _sort: '-date',
        _count: (args.limit || 20).toString()
      };
      
      if (args.category) searchParams.category = args.category;
      if (args.code) searchParams.code = args.code;
      if (args.date) searchParams.date = args.date;

      const response = await this.client.searchResource('Observation', searchParams);
      
      if (!response.entry || response.entry.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'No observations found for this patient',
              observationsFound: 0,
              observations: []
            }, null, 2)
          }]
        };
      }

      const observations = response.entry.map((entry: any) => {
        const obs = entry.resource;
        return {
          id: obs.id,
          status: obs.status,
          category: obs.category?.[0]?.text,
          code: {
            text: obs.code?.text,
            coding: obs.code?.coding?.[0]
          },
          value: this.formatObservationValue(obs),
          unit: obs.valueQuantity?.unit,
          referenceRange: obs.referenceRange?.[0]?.text,
          date: obs.effectiveDateTime || obs.effectivePeriod?.start,
          performer: obs.performer?.[0]?.display,
          interpretation: obs.interpretation?.[0]?.text
        };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            observationsFound: observations.length,
            patientId: args.patientId,
            observations
          }, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError('getPatientObservations', error);
    }
  }

  // Tool 4: Get Patient Medications
  createGetMedicationsTool(): Tool {
    return {
      name: 'epicGetPatientMedications',
      description: 'Get current and past medications for a patient',
      inputSchema: {
        type: 'object',
        properties: {
          patientId: {
            type: 'string',
            description: 'FHIR Patient ID',
            minLength: 1
          },
          status: {
            type: 'string',
            enum: ['active', 'completed', 'stopped', 'on-hold', 'cancelled'],
            description: 'Medication status filter'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20)',
            minimum: 1,
            maximum: 100
          }
        },
        required: ['patientId']
      }
    };
  }

  async handleGetMedications(args: {
    patientId: string;
    status?: string;
    limit?: number;
  }): Promise<any> {
    try {
      const searchParams: Record<string, string> = {
        patient: args.patientId,
        _sort: '-_lastUpdated',
        _count: (args.limit || 20).toString()
      };
      
      if (args.status) searchParams.status = args.status;

      const response = await this.client.searchResource('MedicationRequest', searchParams);
      
      if (!response.entry || response.entry.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'No medications found for this patient',
              medicationsFound: 0,
              medications: []
            }, null, 2)
          }]
        };
      }

      const medications = response.entry.map((entry: any) => {
        const med = entry.resource;
        return {
          id: med.id,
          status: med.status,
          medication: {
            text: med.medicationCodeableConcept?.text,
            coding: med.medicationCodeableConcept?.coding?.[0]
          },
          dosage: med.dosageInstruction?.[0]?.text,
          authoredOn: med.authoredOn,
          requester: med.requester?.display,
          reasonCode: med.reasonCode?.[0]?.text,
          note: med.note?.map((note: any) => note.text),
          dispenseRequest: med.dispenseRequest
        };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            medicationsFound: medications.length,
            patientId: args.patientId,
            medications
          }, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError('getPatientMedications', error);
    }
  }

  // Tool 5: Get Patient Conditions
  createGetConditionsTool(): Tool {
    return {
      name: 'epicGetPatientConditions',
      description: 'Get medical conditions and diagnoses for a patient',
      inputSchema: {
        type: 'object',
        properties: {
          patientId: {
            type: 'string',
            description: 'FHIR Patient ID',
            minLength: 1
          },
          clinicalStatus: {
            type: 'string',
            enum: ['active', 'inactive', 'resolved'],
            description: 'Clinical status of conditions'
          },
          category: {
            type: 'string',
            description: 'Condition category filter'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20)',
            minimum: 1,
            maximum: 100
          }
        },
        required: ['patientId']
      }
    };
  }

  async handleGetConditions(args: {
    patientId: string;
    clinicalStatus?: string;
    category?: string;
    limit?: number;
  }): Promise<any> {
    try {
      const searchParams: Record<string, string> = {
        patient: args.patientId,
        _sort: '-onset-date',
        _count: (args.limit || 20).toString()
      };
      
      if (args.clinicalStatus) searchParams['clinical-status'] = args.clinicalStatus;
      if (args.category) searchParams.category = args.category;

      const response = await this.client.searchResource('Condition', searchParams);
      
      if (!response.entry || response.entry.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'No conditions found for this patient',
              conditionsFound: 0,
              conditions: []
            }, null, 2)
          }]
        };
      }

      const conditions = response.entry.map((entry: any) => {
        const condition = entry.resource;
        return {
          id: condition.id,
          clinicalStatus: condition.clinicalStatus?.text,
          verificationStatus: condition.verificationStatus?.text,
          category: condition.category?.[0]?.text,
          severity: condition.severity?.text,
          code: {
            text: condition.code?.text,
            coding: condition.code?.coding?.[0]
          },
          onsetDate: condition.onsetDateTime || condition.onsetPeriod?.start,
          abatementDate: condition.abatementDateTime,
          recordedDate: condition.recordedDate,
          recorder: condition.recorder?.display,
          asserter: condition.asserter?.display,
          note: condition.note?.map((note: any) => note.text)
        };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            conditionsFound: conditions.length,
            patientId: args.patientId,
            conditions
          }, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError('getPatientConditions', error);
    }
  }

  // Tool 6: Get Patient Encounters
  createGetEncountersTool(): Tool {
    return {
      name: 'epicGetPatientEncounters',
      description: 'Get healthcare encounters/visits for a patient',
      inputSchema: {
        type: 'object',
        properties: {
          patientId: {
            type: 'string',
            description: 'FHIR Patient ID',
            minLength: 1
          },
          status: {
            type: 'string',
            enum: ['planned', 'arrived', 'in-progress', 'finished', 'cancelled'],
            description: 'Encounter status filter'
          },
          class: {
            type: 'string',
            description: 'Encounter class (inpatient, outpatient, emergency, etc.)'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20)',
            minimum: 1,
            maximum: 100
          }
        },
        required: ['patientId']
      }
    };
  }

  async handleGetEncounters(args: {
    patientId: string;
    status?: string;
    class?: string;
    limit?: number;
  }): Promise<any> {
    try {
      const searchParams: Record<string, string> = {
        patient: args.patientId,
        _sort: '-date',
        _count: (args.limit || 20).toString()
      };
      
      if (args.status) searchParams.status = args.status;
      if (args.class) searchParams.class = args.class;

      const response = await this.client.searchResource('Encounter', searchParams);
      
      if (!response.entry || response.entry.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'No encounters found for this patient',
              encountersFound: 0,
              encounters: []
            }, null, 2)
          }]
        };
      }

      const encounters = response.entry.map((entry: any) => {
        const encounter = entry.resource;
        return {
          id: encounter.id,
          status: encounter.status,
          class: encounter.class?.display,
          type: encounter.type?.[0]?.text,
          serviceType: encounter.serviceType?.text,
          subject: encounter.subject?.display,
          participant: encounter.participant?.map((p: any) => ({
            type: p.type?.[0]?.text,
            individual: p.individual?.display
          })),
          period: encounter.period,
          reasonCode: encounter.reasonCode?.[0]?.text,
          hospitalization: encounter.hospitalization,
          location: encounter.location?.map((loc: any) => ({
            location: loc.location?.display,
            status: loc.status
          })),
          serviceProvider: encounter.serviceProvider?.display
        };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            encountersFound: encounters.length,
            patientId: args.patientId,
            encounters
          }, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError('getPatientEncounters', error);
    }
  }

  // Helper methods for formatting data
  private formatPatientName(names: any[]): string {
    if (!names || names.length === 0) return 'Unknown';
    const name = names[0];
    const given = name.given?.join(' ') || '';
    const family = name.family || '';
    return `${given} ${family}`.trim();
  }

  private extractPhone(telecoms: any[]): string | undefined {
    return telecoms?.find(t => t.system === 'phone')?.value;
  }

  private extractEmail(telecoms: any[]): string | undefined {
    return telecoms?.find(t => t.system === 'email')?.value;
  }

  private formatAddress(addresses: any[]): any {
    if (!addresses || addresses.length === 0) return null;
    const addr = addresses[0];
    return {
      line: addr.line?.join(', '),
      city: addr.city,
      state: addr.state,
      postalCode: addr.postalCode,
      country: addr.country
    };
  }

  private extractMRN(identifiers: any[]): string | undefined {
    return identifiers?.find(id => id.type?.text?.toLowerCase().includes('mrn'))?.value;
  }

  private formatObservationValue(obs: any): any {
    if (obs.valueQuantity) {
      return {
        value: obs.valueQuantity.value,
        unit: obs.valueQuantity.unit,
        system: obs.valueQuantity.system
      };
    }
    if (obs.valueString) return obs.valueString;
    if (obs.valueBoolean !== undefined) return obs.valueBoolean;
    if (obs.valueCodeableConcept) return obs.valueCodeableConcept.text;
    return null;
  }

  private handleError(toolName: string, error: any): any {
    console.error(`Epic FHIR ${toolName} error:`, error);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error.message || 'Unknown error occurred',
          tool: toolName,
          timestamp: new Date().toISOString()
        }, null, 2)
      }],
      isError: true
    };
  }

  // Get all Epic FHIR tools
  getAllTools(): Tool[] {
    return [
      this.createSearchPatientsTool(),
      this.createGetPatientTool(),
      this.createGetObservationsTool(),
      this.createGetMedicationsTool(),
      this.createGetConditionsTool(),
      this.createGetEncountersTool()
    ];
  }
}