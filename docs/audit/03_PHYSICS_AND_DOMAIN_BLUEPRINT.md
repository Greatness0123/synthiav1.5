# Physics & Domain Blueprint Specification

This document details the core domain knowledge, coordinate transforms, kinematic constraints, integrator settings, and mathematical control loops required to rebuild the simulation cleanly.

---

## 1. Kinematic & Skeletal Hierarchy

To accurately link 3D visual representations with stable physical solvers, the bipedal simulation maps standard Mixamo humanoid rigs to hierarchical joint configurations.

### 1.1 Root Capsule Placement
*   **The Capsule Anchor**: The core physical body is a single vertically-oriented capsule named `root_capsule`.
*   **Freejoint Constraint**: The capsule is placed directly under the world body element and assigned a freejoint element. This grants it full 6 DOF movement (unconstrained linear and angular motion).
*   **Collision Deactivation**: The capsule is configured with `contype` set to 0 and `conaffinity` set to 0 to disable active collisions. This prevents the large central capsule from colliding with legs or feet, which would cause numerical instability and vertical height drift.

### 1.2 Skeleton Joint Tree Structure
All bone chains inherit positions directly from the parent capsule to maintain structural integrity. They are linked as nested bodies under `root_capsule`:
1.  **Spine Branch**: `root_capsule` body nests `mixamorigspine` body, which in turn nests `mixamorigspine1`, nesting `mixamorigspine2`, nesting neck, and finally nesting the head body.
2.  **Left Leg Branch**: `root_capsule` nests `mixamorigleftupleg` (hip), which nests `mixamorigleftleg` (knee), nesting `mixamorigleftfoot` (ankle).
3.  **Right Leg Branch**: `root_capsule` nests `mixamorigrightupleg` (hip), which nests `mixamorigrightleg` (knee), nesting `mixamorigrightfoot` (ankle).
4.  **Arm Branches**: `mixamorigspine2` nests Left and Right shoulders, nesting Upper Arms, nesting Forearms (elbows), nesting Hands, and finally nesting Finger chains.

---

## 2. Coordinate Systems & Matrix Conversions

The simulation must bridge two different coordinate frameworks:
*   **Three.js**: Standard Y-up, right-handed coordinate system.
*   **MuJoCo**: Native Z-up, right-handed coordinate system.

### 2.1 Spatial Point Conversions
Translations map between coordinate spaces using the following vector transformations:
*   **World to MuJoCo**: The Three.js vector ($v_x, v_y, v_z$) maps to the MuJoCo vector [$v_x, -v_z, v_y$].
*   **MuJoCo to World**: The MuJoCo coordinate array [$p_0, p_1, p_2$] maps to the Three.js vector ($p_0, p_2, -p_1$).

### 2.2 Quaternion Rotational Conversions
Quaternions must account for coordinate frame differences:
*   **Three.js**: Uses scalar-last quaternions: $\mathbf{q} = (x, y, z, w)$.
*   **MuJoCo**: Uses scalar-first quaternions: $\mathbf{q} = (w, x, y, z)$.

Aligning the Y-up frame with the Z-up frame requires a $+90^\circ$ pitch rotation about the $X$-axis ($\mathbf{Q}_{\text{align}}$):

$$\mathbf{Q}_{\text{align}} = \left(\cos\frac{\pi}{4}, \, \sin\frac{\pi}{4}, \, 0, \, 0\right) \approx (0.7071, \, 0.7071, \, 0, \, 0)$$

The rotation is transformed using quaternion conjugation:

$$\mathbf{q}_{\text{mujoco}} = \mathbf{Q}_{\text{align}} \otimes \mathbf{q}_{\text{three}} \otimes \mathbf{Q}_{\text{align}}^{-1}$$

---

## 3. MuJoCo Engine Configuration

### 3.1 Solver Settings
The simulation configures the MuJoCo solver using key environmental parameters:
*   **Gravity**: Configured as a negative vertical force on the $Z$-axis: `[0, 0, -9.81]`.
*   **Time Step**: Evaluates at a fixed rate of 60 Hz (`timestep` attribute set to `0.01667`).
*   **Solver Iterations**: Uses 100 solver iterations to ensure stable force calculations.
*   **Numerical Integrator**: Uses the `implicitfast` Euler integration scheme (`integrator` attribute). This provides strong stability for high-gain position actuators and high joint velocities.

### 3.2 Mass, Inertia, and Material Properties
*   **Inertial Override**: Explicit `<inertial>` tags define the mass and principal moments of inertia ($I_{xx}, I_{yy}, I_{zz}$) for each body segment. This completely overrides geom density calculations to ensure realistic mass distribution across limbs (e.g. setting local body mass to 0.5 and diagonal inertia elements to match principal axes).
*   **Sole Geoms**: Box shapes with dimension vectors `size="0.05 0.11 0.01"` represent the feet. These flat box geometries establish a true 2D support polygon, avoiding the rotational drift caused by rounded capsule feet (the "rolling pin" effect).
*   **Collision Filtering**:
    *   **Ground/Terrain**: Configured with `contype` as 1 and `conaffinity` as 2.
    *   **Humanoid Limbs**: Configured with `contype` as 2 and `conaffinity` as 1.
    *   **Interactive Objects**: Configured with `contype` as 2 and `conaffinity` as 3.
    This setup prevents limbs from self-colliding while ensuring they collide correctly with the ground, terrain, and world objects.

### 3.3 Joint Specification Semantics
High-mobility joints (like the hips, ankles, spine, and shoulders) are modeled as decomposed hinges within a single `<body>` segment to maintain stable kinematics:
*   **Revolute Joint (1 DOF)**: Uses a single hinge element. It defines a joint of type `hinge`, set to roll or pitch along a specific axis (e.g., axis `1 0 0`), with limits enabled and range set to biological limits.
*   **Spherical Joint (3 DOF)**: Modeled using three orthogonal hinge elements defined within a single body:
    1.  **Yaw** axis: Joint of type `hinge` along the axis `0 0 1`.
    2.  **Pitch** axis: Joint of type `hinge` along the axis `1 0 0`.
    3.  **Roll** axis: Joint of type `hinge` along the axis `0 1 0`.
    All three joints have limits enabled and use biological ranges of motion.

### 3.4 Actuator Specifications
Joints are driven by position-controlled actuators using the `<position>` element:
*   **Proportional-Derivative (PD) Servo Parameters**:
    *   **Hips & Knees**: $k_p = 400, \, k_d = 80$. Provides high stiffness for bipedal standing.
    *   **Spine**: $k_p = 300, \, k_d = 60$. Supports upright torso balance.
    *   **Arms & Forearms**: $k_p = 200, \, k_d = 40$. Allows smooth reaching motion.
    *   **Neck & Head**: $k_p = 150, \, k_d = 30$. Provides stable visual tracking.
    *   **Ankles & Feet**: $k_p = 150, \, k_d = 40$. Supports balance adjustments.
*   **Torque Limits and Gear Scaling**:
    *   `<position>` actuators in MuJoCo ignore the `gear` attribute for torque scaling. Torque limits must be set explicitly using the `forcerange` attribute on the actuator.
    *   Joint stabilization uses armature inertia (`armature` set to `0.02`) and Coulomb joint friction (`frictionloss` set to `0.1`) on leg joints to prevent high-frequency oscillations.

---

## 4. Control Loop Mechanics

The simulation runs a dual control loop that combines active balance torques with native joint actuator commands.

### 4.1 Upright Balance Controller (`applyCapsuleBalance`)
Active balance is maintained by applying corrective torques directly to the root capsule body. Since free joints cannot host standard actuators, torques are written directly to the capsule's applied force array (`xfrc_applied`), which holds 6 elements corresponding to three force elements and three torque elements in world coordinates.

1.  **Orientation Error Calculation**:
    Given the root capsule orientation quaternion $\mathbf{q}$, project the local vertical axis $\mathbf{u}_{\text{local}} = \begin{bmatrix} 0 & 1 & 0 \end{bmatrix}^T$ into the world space:

    $$\mathbf{u}_{\text{world}} = \mathbf{q} \otimes \mathbf{u}_{\text{local}} \otimes \mathbf{q}^{-1}$$

    The tilt angle $\theta$ relative to the world vertical vector $\mathbf{v}_{\text{world}} = \begin{bmatrix} 0 & 1 & 0 \end{bmatrix}^T$ is:

    $$\theta = \arccos\left(\mathbf{u}_{\text{world}} \cdot \mathbf{v}_{\text{world}}\right)$$

    The corrective tilt axis $\mathbf{a}$ is perpendicular to both vectors:

    $$\mathbf{a} = \frac{\mathbf{u}_{\text{world}} \times \mathbf{v}_{\text{world}}}{\|\mathbf{u}_{\text{world}} \times \mathbf{v}_{\text{world}}\|}$$

2.  **Balancing Torque Formulation**:
    Combining proportional orientation feedback with angular velocity damping yields the corrective torque vector:

    $$\boldsymbol{\tau}_{\text{corrective}} = K_p \, \theta \, \mathbf{a} - K_d \, \boldsymbol{\omega}_{\text{world}}$$

    Where $K_p$ represents proportional balance stiffness ($100.0$), $K_d$ represents derivative damping ($40.0$), and $\boldsymbol{\omega}_{\text{world}}$ is the capsule's angular velocity.

3.  **Torque Limiting**:
    To prevent excessive force applications, the corrective torque is clamped to a maximum magnitude of 60.0:

    $$\boldsymbol{\tau}_{\text{clamped}} = \begin{cases} \boldsymbol{\tau}_{\text{corrective}} & \text{if } \|\boldsymbol{\tau}_{\text{corrective}}\| \le 60.0 \\ 60.0 \, \frac{\boldsymbol{\tau}_{\text{corrective}}}{\|\boldsymbol{\tau}_{\text{corrective}}\|} & \text{otherwise} \end{cases}$$

---

### 4.2 Joint Target Updates & Soft-Start Mechanics
To prevent extreme movements on startup or pose resets, control signals are scaled linearly over the first 20 simulation frames using a ramping factor ($\alpha$):

$$\alpha = \min\left(1.0, \, \frac{n_{\text{step}}}{20}\right)$$

$$ctrl_i = \alpha \cdot \theta_{\text{target}}$$

*   **Idle Mode**: When no user input is received, the joints default to a neutral standing pose: straight legs ($\theta = 0.0$) and relaxed arms ($\theta = 75^\circ$) to keep the feet firmly on the ground.
*   **Active Mode**: Incoming AI joint targets are validated against joint limits and applied as offsets:

$$ctrl_i = \alpha \cdot \left(\theta_{\text{preset}} + \gamma \cdot \Delta\theta_{\text{AI}}\right)$$

---

### 4.3 Kinematic Ground Reaction Forces (GRF)
When operating in multi-body mode, contact forces at the feet are mapped to the root capsule's velocity arrays (`qvel`) to simulate realistic traction and friction:

1.  **Contact Force Sampling**:
    The system reads the contact force registry. If a foot segment (left or right foot) is in contact with the ground, it extracts the contact normal vector ($\mathbf{n}$) and the total contact impulse ($I_{\text{total}}$).
2.  **Impulse Application**:
    The contact impulse is projected onto the biped's forward heading vector ($\mathbf{f}_{\text{heading}}$). This lateral force and its resulting torque are applied directly to the capsule's linear and angular velocity slots in `qvel`:

    $$\mathbf{v}_{\text{next}} = \mathbf{v}_{\text{current}} + \frac{\mathbf{f}_{\text{impulse}}}{M}$$

    $$\boldsymbol{\omega}_{\text{next}} = \boldsymbol{\omega}_{\text{current}} + \frac{\boldsymbol{\tau}_{\text{impulse}}}{J}$$

    Where $M$ is the biped's mass ($70\text{ kg}$) and $J$ represents the rotatory inertia coefficient ($10.0$).
