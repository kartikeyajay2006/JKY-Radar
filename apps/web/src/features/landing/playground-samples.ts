export const BASELINE = `openapi: 3.1.0
info:
  title: Orders API
  version: 1.0.0
paths:
  /orders/{id}:
    get:
      operationId: getOrder
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        '200':
          description: The order
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Order'
  /orders:
    post:
      operationId: createOrder
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [sku, quantity]
              properties:
                sku: { type: string }
                quantity: { type: integer, minimum: 1 }
      responses:
        '201':
          description: Created
components:
  schemas:
    Order:
      type: object
      required: [id, status, email]
      properties:
        id: { type: string }
        status: { type: string, enum: [pending, paid, shipped] }
        email: { type: string, format: email }
`;

export const PRESETS = {
  breaking: {
    label: 'Breaking release',
    text: BASELINE.replace('version: 1.0.0', 'version: 2.0.0')
      .replace('required: [sku, quantity]', 'required: [sku, quantity, currency]')
      .replace(
        'quantity: { type: integer, minimum: 1 }',
        'quantity: { type: integer, minimum: 1 }\n                currency: { type: string }',
      )
      .replace('required: [id, status, email]', 'required: [id, status]')
      .replace('        email: { type: string, format: email }\n', '')
      .replace('enum: [pending, paid, shipped]', 'enum: [pending, paid, shipped, refunded]'),
  },
  safe: {
    label: 'Safe release',
    text: BASELINE.replace('version: 1.0.0', 'version: 1.1.0')
      .replace(
        'quantity: { type: integer, minimum: 1 }',
        'quantity: { type: integer, minimum: 1 }\n                giftNote: { type: string, maxLength: 200 }',
      )
      .replace(
        '        email: { type: string, format: email }\n',
        '        email: { type: string, format: email }\n        trackingUrl: { type: string }\n',
      ),
  },
  uncertain: {
    label: 'Uncertain release',
    text: BASELINE.replace('version: 1.0.0', 'version: 1.2.0').replace(
      `              schema:
                $ref: '#/components/schemas/Order'`,
      `              schema:
                oneOf:
                  - $ref: '#/components/schemas/Order'
                  - type: object
                    properties:
                      archived: { type: boolean }`,
    ),
  },
} as const;

export type PresetId = keyof typeof PRESETS;
