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
  // Additional EPIC FHIR R4 Tools
// Add these methods to the EpicFHIRTools class in epic-fhir-tools.ts

// Tool 7: Create Patient (Demographics)
createCreatePatientTool(): Tool {
  return {
    name: 'epicCreatePatient',
    description: 'Create a new patient with demographics (FHIR R4)',
    inputSchema: {
      type: 'object',
      properties: {
        given: {
          type: 'string',
          description: 'Patient first name',
          minLength: 1
        },
        family: {
          type: 'string',
          description: 'Patient last name',
          minLength: 1
        },
        birthDate: {
          type: 'string',
          description: 'Birth date (YYYY-MM-DD)',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$'
        },
        gender: {
          type: 'string',
          enum: ['male', 'female', 'other', 'unknown'],
          description: 'Administrative gender'
        },
        phone: {
          type: 'string',
          description: 'Primary phone number'
        },
        email: {
          type: 'string',
          description: 'Email address',
          format: 'email'
        },
        address: {
          type: 'object',
          properties: {
            line: {
              type: 'array',
              items: { type: 'string' },
              description: 'Street address lines'
            },
            city: { type: 'string' },
            state: { type: 'string' },
            postalCode: { type: 'string' },
            country: { type: 'string' }
          }
        },
        identifier: {
          type: 'string',
          description: 'Medical Record Number (MRN)'
        }
      },
      required: ['given', 'family', 'birthDate', 'gender']
    }
  };
}

async handleCreatePatient(args: {
  given: string;
  family: string;
  birthDate: string;
  gender: string;
  phone?: string;
  email?: string;
  address?: any;
  identifier?: string;
}): Promise<any> {
  try {
    const patient: any = {
      resourceType: 'Patient',
      active: true,
      name: [{
        use: 'official',
        given: [args.given],
        family: args.family
      }],
      birthDate: args.birthDate,
      gender: args.gender
    };

    // Add contact information
    if (args.phone || args.email) {
      patient.telecom = [];
      if (args.phone) {
        patient.telecom.push({
          system: 'phone',
          value: args.phone,
          use: 'mobile'
        });
      }
      if (args.email) {
        patient.telecom.push({
          system: 'email',
          value: args.email
        });
      }
    }

    // Add address
    if (args.address) {
      patient.address = [{
        use: 'home',
        line: args.address.line || [],
        city: args.address.city,
        state: args.address.state,
        postalCode: args.address.postalCode,
        country: args.address.country || 'US'
      }];
    }

    // Add identifier (MRN)
    if (args.identifier) {
      patient.identifier = [{
        use: 'official',
        type: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
            code: 'MR'
          }],
          text: 'Medical Record Number'
        },
        value: args.identifier
      }];
    }

    const created = await this.client.createResource('Patient', patient);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Patient created successfully',
          patientId: created.id,
          patient: {
            id: created.id,
            name: this.formatPatientName(created.name),
            birthDate: created.birthDate,
            gender: created.gender,
            mrn: args.identifier
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    return this.handleError('createPatient', error);
  }
}

// Tool 8: Create DocumentReference (Clinical Notes)
createCreateClinicalNoteTool(): Tool {
  return {
    name: 'epicCreateClinicalNote',
    description: 'Create a clinical note document reference (FHIR R4)',
    inputSchema: {
      type: 'object',
      properties: {
        patientId: {
          type: 'string',
          description: 'FHIR Patient ID',
          minLength: 1
        },
        type: {
          type: 'string',
          enum: ['progress-note', 'consultation-note', 'discharge-summary', 'history-and-physical'],
          description: 'Type of clinical note'
        },
        status: {
          type: 'string',
          enum: ['current', 'superseded', 'entered-in-error'],
          description: 'Document status (default: current)'
        },
        description: {
          type: 'string',
          description: 'Document description/title'
        },
        content: {
          type: 'string',
          description: 'The actual note content (plain text or base64 encoded)'
        },
        contentType: {
          type: 'string',
          enum: ['text/plain', 'application/pdf', 'text/rtf', 'text/html'],
          description: 'MIME type of the content'
        },
        authorId: {
          type: 'string',
          description: 'FHIR Practitioner ID who authored the note'
        },
        context: {
          type: 'object',
          properties: {
            encounterId: {
              type: 'string',
              description: 'Related encounter ID'
            },
            period: {
              type: 'object',
              properties: {
                start: { type: 'string' },
                end: { type: 'string' }
              }
            }
          }
        }
      },
      required: ['patientId', 'type', 'description', 'content', 'contentType']
    }
  };
}

async handleCreateClinicalNote(args: {
  patientId: string;
  type: string;
  status?: string;
  description: string;
  content: string;
  contentType: string;
  authorId?: string;
  context?: any;
}): Promise<any> {
  try {
    const documentReference: any = {
      resourceType: 'DocumentReference',
      status: args.status || 'current',
      type: {
        coding: [{
          system: 'http://loinc.org',
          code: this.getClinicalNoteCode(args.type),
          display: this.getClinicalNoteDisplay(args.type)
        }]
      },
      subject: {
        reference: `Patient/${args.patientId}`
      },
      date: new Date().toISOString(),
      description: args.description,
      content: [{
        attachment: {
          contentType: args.contentType,
          data: args.contentType === 'text/plain' ? 
            Buffer.from(args.content).toString('base64') : 
            args.content,
          creation: new Date().toISOString()
        }
      }]
    };

    // Add author if provided
    if (args.authorId) {
      documentReference.author = [{
        reference: `Practitioner/${args.authorId}`
      }];
    }

    // Add context if provided
    if (args.context) {
      documentReference.context = {};
      if (args.context.encounterId) {
        documentReference.context.encounter = [{
          reference: `Encounter/${args.context.encounterId}`
        }];
      }
      if (args.context.period) {
        documentReference.context.period = args.context.period;
      }
    }

    const created = await this.client.createResource('DocumentReference', documentReference);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Clinical note created successfully',
          documentId: created.id,
          document: {
            id: created.id,
            type: args.type,
            description: args.description,
            status: documentReference.status,
            date: documentReference.date
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    return this.handleError('createClinicalNote', error);
  }
}

// Tool 9: Create DocumentReference (Document Information)
createCreateDocumentInfoTool(): Tool {
  return {
    name: 'epicCreateDocumentInfo',
    description: 'Create a document reference for general medical documents (FHIR R4)',
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
          enum: ['clinical-note', 'imaging', 'laboratory', 'procedure', 'other'],
          description: 'Document category'
        },
        type: {
          type: 'string',
          description: 'Specific document type code'
        },
        description: {
          type: 'string',
          description: 'Document description'
        },
        status: {
          type: 'string',
          enum: ['current', 'superseded', 'entered-in-error'],
          description: 'Document status'
        },
        docStatus: {
          type: 'string',
          enum: ['preliminary', 'final', 'amended', 'entered-in-error'],
          description: 'Document composition status'
        },
        identifier: {
          type: 'string',
          description: 'External document identifier'
        },
        relatesTo: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                enum: ['replaces', 'transforms', 'signs', 'appends'],
                description: 'Relationship type'
              },
              targetId: {
                type: 'string',
                description: 'Target document ID'
              }
            }
          }
        },
        securityLabel: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['restricted', 'confidential', 'normal']
          }
        }
      },
      required: ['patientId', 'category', 'description']
    }
  };
}

async handleCreateDocumentInfo(args: {
  patientId: string;
  category: string;
  type?: string;
  description: string;
  status?: string;
  docStatus?: string;
  identifier?: string;
  relatesTo?: any[];
  securityLabel?: string[];
}): Promise<any> {
  try {
    const documentReference: any = {
      resourceType: 'DocumentReference',
      status: args.status || 'current',
      docStatus: args.docStatus || 'final',
      subject: {
        reference: `Patient/${args.patientId}`
      },
      date: new Date().toISOString(),
      description: args.description,
      category: [{
        coding: [{
          system: 'http://hl7.org/fhir/ValueSet/document-classcodes',
          code: args.category,
          display: this.formatCategoryDisplay(args.category)
        }]
      }]
    };

    // Add type if provided
    if (args.type) {
      documentReference.type = {
        text: args.type
      };
    }

    // Add identifier if provided
    if (args.identifier) {
      documentReference.identifier = [{
        value: args.identifier
      }];
    }

    // Add relationships if provided
    if (args.relatesTo && args.relatesTo.length > 0) {
      documentReference.relatesTo = args.relatesTo.map(rel => ({
        code: rel.code,
        target: {
          reference: `DocumentReference/${rel.targetId}`
        }
      }));
    }

    // Add security labels if provided
    if (args.securityLabel && args.securityLabel.length > 0) {
      documentReference.securityLabel = args.securityLabel.map(label => ({
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
          code: label.toUpperCase()
        }]
      }));
    }

    const created = await this.client.createResource('DocumentReference', documentReference);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Document reference created successfully',
          documentId: created.id,
          document: {
            id: created.id,
            category: args.category,
            description: args.description,
            status: documentReference.status,
            docStatus: documentReference.docStatus,
            date: documentReference.date
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    return this.handleError('createDocumentInfo', error);
  }
}

// Tool 10: Update Patient
createUpdatePatientTool(): Tool {
  return {
    name: 'epicUpdatePatient',
    description: 'Update existing patient information (FHIR R4)',
    inputSchema: {
      type: 'object',
      properties: {
        patientId: {
          type: 'string',
          description: 'FHIR Patient ID to update',
          minLength: 1
        },
        given: { type: 'string' },
        family: { type: 'string' },
        birthDate: { type: 'string' },
        gender: { 
          type: 'string',
          enum: ['male', 'female', 'other', 'unknown']
        },
        phone: { type: 'string' },
        email: { type: 'string' },
        active: { type: 'boolean' },
        address: {
          type: 'object',
          properties: {
            line: { type: 'array', items: { type: 'string' } },
            city: { type: 'string' },
            state: { type: 'string' },
            postalCode: { type: 'string' },
            country: { type: 'string' }
          }
        }
      },
      required: ['patientId']
    }
  };
}

async handleUpdatePatient(args: any): Promise<any> {
  try {
    // Get existing patient
    const existing = await this.client.getResource('Patient', args.patientId);
    
    // Update fields if provided
    if (args.given || args.family) {
      existing.name = existing.name || [{}];
      if (args.given) existing.name[0].given = [args.given];
      if (args.family) existing.name[0].family = args.family;
    }
    
    if (args.birthDate !== undefined) existing.birthDate = args.birthDate;
    if (args.gender !== undefined) existing.gender = args.gender;
    if (args.active !== undefined) existing.active = args.active;
    
    // Update telecom
    if (args.phone || args.email) {
      existing.telecom = existing.telecom || [];
      
      if (args.phone) {
        const phoneIndex = existing.telecom.findIndex((t: any) => t.system === 'phone');
        if (phoneIndex >= 0) {
          existing.telecom[phoneIndex].value = args.phone;
        } else {
          existing.telecom.push({ system: 'phone', value: args.phone });
        }
      }
      
      if (args.email) {
        const emailIndex = existing.telecom.findIndex((t: any) => t.system === 'email');
        if (emailIndex >= 0) {
          existing.telecom[emailIndex].value = args.email;
        } else {
          existing.telecom.push({ system: 'email', value: args.email });
        }
      }
    }

    // Update address
    if (args.address) {
      existing.address = existing.address || [{}];
      Object.assign(existing.address[0], args.address);
    }

    const updated = await this.client.updateResource('Patient', args.patientId, existing);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Patient updated successfully',
          patient: {
            id: updated.id,
            name: this.formatPatientName(updated.name),
            birthDate: updated.birthDate,
            gender: updated.gender,
            active: updated.active
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    return this.handleError('updatePatient', error);
  }
}

// Tool 11: Create Observation
createCreateObservationTool(): Tool {
  return {
    name: 'epicCreateObservation',
    description: 'Create a new observation (lab result, vital sign) (FHIR R4)',
    inputSchema: {
      type: 'object',
      properties: {
        patientId: {
          type: 'string',
          description: 'FHIR Patient ID',
          minLength: 1
        },
        code: {
          type: 'string',
          description: 'LOINC code for the observation'
        },
        display: {
          type: 'string',
          description: 'Display name for the observation'
        },
        value: {
          type: 'number',
          description: 'Numeric value of the observation'
        },
        unit: {
          type: 'string',
          description: 'Unit of measurement'
        },
        category: {
          type: 'string',
          enum: ['vital-signs', 'laboratory', 'exam', 'survey', 'procedure'],
          description: 'Observation category'
        },
        status: {
          type: 'string',
          enum: ['registered', 'preliminary', 'final', 'amended'],
          description: 'Observation status (default: final)'
        },
        effectiveDateTime: {
          type: 'string',
          description: 'When the observation was taken (ISO datetime)'
        },
        performerId: {
          type: 'string',
          description: 'FHIR Practitioner ID who performed the observation'
        },
        interpretation: {
          type: 'string',
          enum: ['normal', 'abnormal', 'high', 'low', 'critical'],
          description: 'Clinical interpretation'
        }
      },
      required: ['patientId', 'code', 'display', 'value', 'unit', 'category']
    }
  };
}

async handleCreateObservation(args: any): Promise<any> {
  try {
    const observation: any = {
      resourceType: 'Observation',
      status: args.status || 'final',
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: args.category,
          display: this.formatCategoryDisplay(args.category)
        }]
      }],
      code: {
        coding: [{
          system: 'http://loinc.org',
          code: args.code,
          display: args.display
        }],
        text: args.display
      },
      subject: {
        reference: `Patient/${args.patientId}`
      },
      effectiveDateTime: args.effectiveDateTime || new Date().toISOString(),
      valueQuantity: {
        value: args.value,
        unit: args.unit,
        system: 'http://unitsofmeasure.org',
        code: args.unit
      }
    };

    // Add performer if provided
    if (args.performerId) {
      observation.performer = [{
        reference: `Practitioner/${args.performerId}`
      }];
    }

    // Add interpretation if provided
    if (args.interpretation) {
      observation.interpretation = [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
          code: args.interpretation.toUpperCase(),
          display: this.formatInterpretationDisplay(args.interpretation)
        }]
      }];
    }

    const created = await this.client.createResource('Observation', observation);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Observation created successfully',
          observationId: created.id,
          observation: {
            id: created.id,
            code: args.display,
            value: args.value,
            unit: args.unit,
            category: args.category,
            effectiveDateTime: observation.effectiveDateTime
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    return this.handleError('createObservation', error);
  }
}

// Helper methods for the new tools
private getClinicalNoteCode(type: string): string {
  const codeMap: Record<string, string> = {
    'progress-note': '11506-3',
    'consultation-note': '11488-4',
    'discharge-summary': '18842-5',
    'history-and-physical': '34117-2'
  };
  return codeMap[type] || '11506-3';
}

private getClinicalNoteDisplay(type: string): string {
  const displayMap: Record<string, string> = {
    'progress-note': 'Progress note',
    'consultation-note': 'Consultation note',
    'discharge-summary': 'Discharge summary',
    'history-and-physical': 'History and physical note'
  };
  return displayMap[type] || 'Clinical note';
}

private formatCategoryDisplay(category: string): string {
  return category.split('-').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

private formatInterpretationDisplay(interpretation: string): string {
  const displayMap: Record<string, string> = {
    'normal': 'Normal',
    'abnormal': 'Abnormal',
    'high': 'High',
    'low': 'Low',
    'critical': 'Critical'
  };
  return displayMap[interpretation] || interpretation;
}

// Tool 12: Create MedicationRequest
createCreateMedicationRequestTool(): Tool {
  return {
    name: 'epicCreateMedicationRequest',
    description: 'Create a new medication request/prescription (FHIR R4)',
    inputSchema: {
      type: 'object',
      properties: {
        patientId: {
          type: 'string',
          description: 'FHIR Patient ID',
          minLength: 1
        },
        medicationCode: {
          type: 'string',
          description: 'RxNorm code for the medication'
        },
        medicationDisplay: {
          type: 'string',
          description: 'Medication name/display'
        },
        dosageInstruction: {
          type: 'string',
          description: 'Dosage instructions (e.g., "Take 1 tablet by mouth daily")'
        },
        quantity: {
          type: 'object',
          properties: {
            value: { type: 'number' },
            unit: { type: 'string' }
          }
        },
        daysSupply: {
          type: 'number',
          description: 'Number of days supply'
        },
        refills: {
          type: 'number',
          description: 'Number of refills allowed'
        },
        status: {
          type: 'string',
          enum: ['active', 'on-hold', 'cancelled', 'completed', 'stopped', 'draft'],
          description: 'Medication request status'
        },
        intent: {
          type: 'string',
          enum: ['proposal', 'plan', 'order', 'original-order', 'instance-order'],
          description: 'Intent of the request (default: order)'
        },
        priority: {
          type: 'string',
          enum: ['routine', 'urgent', 'asap', 'stat'],
          description: 'Priority of the request'
        },
        requesterId: {
          type: 'string',
          description: 'FHIR Practitioner ID who requested the medication'
        },
        reasonCode: {
          type: 'string',
          description: 'Reason for the medication'
        }
      },
      required: ['patientId', 'medicationDisplay', 'dosageInstruction']
    }
  };
}

async handleCreateMedicationRequest(args: any): Promise<any> {
  try {
    const medicationRequest: any = {
      resourceType: 'MedicationRequest',
      status: args.status || 'active',
      intent: args.intent || 'order',
      subject: {
        reference: `Patient/${args.patientId}`
      },
      medicationCodeableConcept: {
        text: args.medicationDisplay
      },
      authoredOn: new Date().toISOString(),
      dosageInstruction: [{
        text: args.dosageInstruction
      }]
    };

    // Add medication code if provided
    if (args.medicationCode) {
      medicationRequest.medicationCodeableConcept.coding = [{
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        code: args.medicationCode,
        display: args.medicationDisplay
      }];
    }

    // Add quantity if provided
    if (args.quantity) {
      medicationRequest.dispenseRequest = {
        quantity: {
          value: args.quantity.value,
          unit: args.quantity.unit
        }
      };
    }

    // Add days supply and refills
    if (args.daysSupply || args.refills !== undefined) {
      medicationRequest.dispenseRequest = medicationRequest.dispenseRequest || {};
      if (args.daysSupply) {
        medicationRequest.dispenseRequest.expectedSupplyDuration = {
          value: args.daysSupply,
          unit: 'days',
          system: 'http://unitsofmeasure.org',
          code: 'd'
        };
      }
      if (args.refills !== undefined) {
        medicationRequest.dispenseRequest.numberOfRepeatsAllowed = args.refills;
      }
    }

    // Add priority if provided
    if (args.priority) {
      medicationRequest.priority = args.priority;
    }

    // Add requester if provided
    if (args.requesterId) {
      medicationRequest.requester = {
        reference: `Practitioner/${args.requesterId}`
      };
    }

    // Add reason if provided
    if (args.reasonCode) {
      medicationRequest.reasonCode = [{
        text: args.reasonCode
      }];
    }

    const created = await this.client.createResource('MedicationRequest', medicationRequest);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Medication request created successfully',
          medicationRequestId: created.id,
          medicationRequest: {
            id: created.id,
            medication: args.medicationDisplay,
            dosage: args.dosageInstruction,
            status: medicationRequest.status,
            authoredOn: medicationRequest.authoredOn
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    return this.handleError('createMedicationRequest', error);
  }
}

// Tool 13: Create Condition
createCreateConditionTool(): Tool {
  return {
    name: 'epicCreateCondition',
    description: 'Create a new condition/diagnosis (FHIR R4)',
    inputSchema: {
      type: 'object',
      properties: {
        patientId: {
          type: 'string',
          description: 'FHIR Patient ID',
          minLength: 1
        },
        code: {
          type: 'string',
          description: 'ICD-10 or SNOMED CT code'
        },
        display: {
          type: 'string',
          description: 'Condition name/display'
        },
        clinicalStatus: {
          type: 'string',
          enum: ['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'],
          description: 'Clinical status of the condition'
        },
        verificationStatus: {
          type: 'string',
          enum: ['unconfirmed', 'provisional', 'differential', 'confirmed', 'refuted', 'entered-in-error'],
          description: 'Verification status'
        },
        category: {
          type: 'string',
          enum: ['problem-list-item', 'encounter-diagnosis', 'health-concern'],
          description: 'Category of condition'
        },
        severity: {
          type: 'string',
          enum: ['mild', 'moderate', 'severe'],
          description: 'Severity of the condition'
        },
        onsetDateTime: {
          type: 'string',
          description: 'When the condition started (ISO datetime)'
        },
        abatementDateTime: {
          type: 'string',
          description: 'When the condition resolved (ISO datetime)'
        },
        recorderId: {
          type: 'string',
          description: 'FHIR Practitioner ID who recorded the condition'
        },
        note: {
          type: 'string',
          description: 'Additional notes about the condition'
        }
      },
      required: ['patientId', 'display', 'clinicalStatus']
    }
  };
}

async handleCreateCondition(args: any): Promise<any> {
  try {
    const condition: any = {
      resourceType: 'Condition',
      subject: {
        reference: `Patient/${args.patientId}`
      },
      code: {
        text: args.display
      },
      clinicalStatus: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: args.clinicalStatus
        }]
      },
      recordedDate: new Date().toISOString()
    };

    // Add condition code if provided
    if (args.code) {
      condition.code.coding = [{
        system: 'http://hl7.org/fhir/sid/icd-10',
        code: args.code,
        display: args.display
      }];
    }

    // Add verification status if provided
    if (args.verificationStatus) {
      condition.verificationStatus = {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
          code: args.verificationStatus
        }]
      };
    }

    // Add category if provided
    if (args.category) {
      condition.category = [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-category',
          code: args.category
        }]
      }];
    }

    // Add severity if provided
    if (args.severity) {
      condition.severity = {
        coding: [{
          system: 'http://snomed.info/sct',
          code: this.getSeverityCode(args.severity),
          display: args.severity
        }]
      };
    }

    // Add onset date if provided
    if (args.onsetDateTime) {
      condition.onsetDateTime = args.onsetDateTime;
    }

    // Add abatement date if provided
    if (args.abatementDateTime) {
      condition.abatementDateTime = args.abatementDateTime;
    }

    // Add recorder if provided
    if (args.recorderId) {
      condition.recorder = {
        reference: `Practitioner/${args.recorderId}`
      };
    }

    // Add note if provided
    if (args.note) {
      condition.note = [{
        text: args.note
      }];
    }

    const created = await this.client.createResource('Condition', condition);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Condition created successfully',
          conditionId: created.id,
          condition: {
            id: created.id,
            code: args.display,
            clinicalStatus: args.clinicalStatus,
            recordedDate: condition.recordedDate
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    return this.handleError('createCondition', error);
  }
}

// Tool 14: Create Encounter
createCreateEncounterTool(): Tool {
  return {
    name: 'epicCreateEncounter',
    description: 'Create a new encounter/visit (FHIR R4)',
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
          enum: ['planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled'],
          description: 'Encounter status'
        },
        class: {
          type: 'string',
          enum: ['ambulatory', 'emergency', 'home', 'inpatient', 'observation', 'virtual'],
          description: 'Classification of encounter'
        },
        type: {
          type: 'string',
          description: 'Specific type of encounter (e.g., "Consultation", "Emergency")'
        },
        priority: {
          type: 'string',
          enum: ['routine', 'urgent', 'emergency'],
          description: 'Priority of the encounter'
        },
        period: {
          type: 'object',
          properties: {
            start: {
              type: 'string',
              description: 'Start date/time (ISO datetime)'
            },
            end: {
              type: 'string',
              description: 'End date/time (ISO datetime)'
            }
          }
        },
        reasonCode: {
          type: 'string',
          description: 'Reason for the encounter'
        },
        hospitalization: {
          type: 'object',
          properties: {
            admitSource: {
              type: 'string',
              description: 'From where patient was admitted'
            },
            dischargeDisposition: {
              type: 'string',
              description: 'Category of patient discharge'
            }
          }
        },
        locationId: {
          type: 'string',
          description: 'FHIR Location ID where encounter takes place'
        },
        practitionerId: {
          type: 'string',
          description: 'Primary practitioner responsible for the encounter'
        }
      },
      required: ['patientId', 'status', 'class']
    }
  };
}

async handleCreateEncounter(args: any): Promise<any> {
  try {
    const encounter: any = {
      resourceType: 'Encounter',
      status: args.status,
      class: {
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: args.class.toUpperCase(),
        display: this.formatEncounterClass(args.class)
      },
      subject: {
        reference: `Patient/${args.patientId}`
      }
    };

    // Add type if provided
    if (args.type) {
      encounter.type = [{
        text: args.type
      }];
    }

    // Add priority if provided
    if (args.priority) {
      encounter.priority = {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActPriority',
          code: args.priority
        }]
      };
    }

    // Add period
    if (args.period) {
      encounter.period = {};
      if (args.period.start) encounter.period.start = args.period.start;
      if (args.period.end) encounter.period.end = args.period.end;
    } else {
      // Default to current time for start
      encounter.period = {
        start: new Date().toISOString()
      };
    }

    // Add reason if provided
    if (args.reasonCode) {
      encounter.reasonCode = [{
        text: args.reasonCode
      }];
    }

    // Add hospitalization details if provided
    if (args.hospitalization) {
      encounter.hospitalization = {};
      if (args.hospitalization.admitSource) {
        encounter.hospitalization.admitSource = {
          text: args.hospitalization.admitSource
        };
      }
      if (args.hospitalization.dischargeDisposition) {
        encounter.hospitalization.dischargeDisposition = {
          text: args.hospitalization.dischargeDisposition
        };
      }
    }

    // Add location if provided
    if (args.locationId) {
      encounter.location = [{
        location: {
          reference: `Location/${args.locationId}`
        }
      }];
    }

    // Add practitioner if provided
    if (args.practitionerId) {
      encounter.participant = [{
        type: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
            code: 'ATND',
            display: 'attender'
          }]
        }],
        individual: {
          reference: `Practitioner/${args.practitionerId}`
        }
      }];
    }

    const created = await this.client.createResource('Encounter', encounter);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Encounter created successfully',
          encounterId: created.id,
          encounter: {
            id: created.id,
            status: args.status,
            class: args.class,
            period: encounter.period
          }
        }, null, 2)
      }]
    };
  } catch (error) {
    return this.handleError('createEncounter', error);
  }
}

  // Helper method for severity codes
  private getSeverityCode(severity: string): string {
    const severityMap: Record<string, string> = {
      'mild': '255604002',
      'moderate': '6736007',
      'severe': '24484000'
    };
    return severityMap[severity] || '255604002';
  }

  // Helper method for encounter class formatting
  private formatEncounterClass(encounterClass: string): string {
    const classMap: Record<string, string> = {
      'ambulatory': 'Ambulatory',
      'emergency': 'Emergency',
      'home': 'Home',
      'inpatient': 'Inpatient',
      'observation': 'Observation',
      'virtual': 'Virtual'
    };
    return classMap[encounterClass] || encounterClass;
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

// Update the getAllTools method to include all the new tools
getAllTools(): Tool[] {
  return [
    // Existing read tools
    this.createSearchPatientsTool(),
    this.createGetPatientTool(),
    this.createGetObservationsTool(),
    this.createGetMedicationsTool(),
    this.createGetConditionsTool(),
    this.createGetEncountersTool(),
    // New create/update tools
    this.createCreatePatientTool(),
    this.createCreateClinicalNoteTool(),
    this.createCreateDocumentInfoTool(),
    this.createUpdatePatientTool(),
    this.createCreateObservationTool(),
    this.createCreateMedicationRequestTool(),
    this.createCreateConditionTool(),
    this.createCreateEncounterTool()
  ];
}
}