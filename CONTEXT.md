# Warung Agent Payments

Two AI agents trade food orders: a buyer agent acting for a person pays a seller agent acting for a warung, using x402 with test USDC, and every payment passes a decision first.

## Language

### Parties

**Buyer Agent**:
The LLM agent that acts for the user: reads the menu, asks the Warung Agent questions, orders and pays.
_Avoid_: My Agent, client

**Warung Agent**:
The LLM agent that acts for the warung: answers the Buyer Agent's questions about its menu and charges for orders.
_Avoid_: Warung Server, seller server

**Facilitator**:
The third-party service that verifies a signed payment and settles it onchain for the Warung Agent.

### Paying

**Payment Request**:
The warung's demand for payment before an order is accepted, carrying the requested price.
_Avoid_: 402, invoice, bill

**Order**:
Everything the user asked for in one request, possibly several items and quantities, paid with a single Payment Request.
_Avoid_: cart, basket

**Menu Price**:
What an Order should cost according to the warung's menu: the sum of each item's menu price times its quantity.

**Requested Price**:
The price stated in a Payment Request, which may differ from the Menu Price.

**Budget**:
The most the user has allowed the Buyer Agent to spend on one Order.

**Payment Decision**:
Jev's verdict on a Payment Request: approve, reject, or ask_human.

**Guardrail**:
A fixed rule that overrides the Payment Decision: a Requested Price above the Menu Price is always rejected, and an approved Requested Price above the Budget goes to the user instead.

**Mock Payment**:
A stand-in for x402 that keeps the same request, Payment Request and retry steps but moves no money onchain.
