// Copyright 2016-2018, Pulumi Corporation.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import * as utils from "../utils";

import * as module from ".";

export declare type HostOperatingSystem = "linux" | "windows";

export type ContainerDefinition = utils.Overwrite<aws.ecs.ContainerDefinition, {
    /**
     * Not provided.  Use [port] instead.
     */
    portMappings?: never;

    /**
     * The port information to create a load balancer for.  At most one container in a service
     * can have this set.  Should not be set for containers intended for TaskDeinitions that will
     * just be run, and will not be part of an aws.ecs.Service.
     */
    loadBalancerPort?: module.ClusterLoadBalancerPort;

    environment?: pulumi.Input<Record<string, pulumi.Input<string>>>;
}>;

export type ClusterTaskDefinitionArgs = utils.Overwrite<aws.ecs.TaskDefinitionArgs, {
    // /**
    //  * Whether or not a load balancer should be created.  A load balancer is required for
    //  * a Service but should not be created for a Task.  If true, a load balancer will be
    //  * created for the first container in [containers] that specifies a loadBalancerPort
    //  */
    // createLoadBalancer: boolean;

    /** Not used.  Provide  [containers] instead. */
    containerDefinitions?: never;

    /**
     * All the containers to make a ClusterTaskDefinition from.  Useful when creating a
     * ClusterService that will contain many containers within.
     */
    containers: Record<string, ContainerDefinition>;

    /**
     * Log group for logging information related to the service.  If not provided a default instance
     * with a one-day retention policy will be created.for no log group.
     */
    logGroup?: aws.cloudwatch.LogGroup

    /**
     * Not used.  Provide [taskRole] instead.
     */
    taskRoleArn?: never;
    /**
     * IAM role that allows your Amazon ECS container task to make calls to other AWS services.
     * If not provided, a default will be created for the task.
     */
    taskRole?: aws.iam.Role;

    /**
     * Not used.  Provide [executionRole] instead.
     */
    executionRoleArn?: never;

    /**
     * The execution role that the Amazon ECS container agent and the Docker daemon can assume.
     *
     * If not provided, a default will be created for the task.
     */
    executionRole?: aws.iam.Role;

    /**
     * The number of cpu units used by the task.  If not provided, a default will be computed
     * based on the cumulative needs specified by [containerDefinitions]
     */
    cpu?: pulumi.Input<string>;

    /**
     * The amount (in MiB) of memory used by the task.  If not provided, a default will be computed
     * based on the cumulative needs specified by [containerDefinitions]
     */
    memory?: pulumi.Input<string>;

    /**
     * A set of launch types required by the task. The valid values are `EC2` and `FARGATE`.
     */
    requiresCompatibilities: pulumi.Input<["FARGATE"] | ["EC2"]>;

    /**
     * The Docker networking mode to use for the containers in the task. The valid values are
     * `none`, `bridge`, `awsvpc`, and `host`.
     */
    networkMode?: pulumi.Input<"none" | "bridge" | "awsvpc" | "host">;
}>;

export interface TaskRunOptions {
    /**
     * The name of the container to run as a task.  If not provided, the first container in the list
     * of containers in the ClusterTaskDefinition will be the one that is run.
     */
    containerName?: string;

    /**
     * The OS to run.  Defaults to 'linux' if unspecified.
     */
    os?: HostOperatingSystem;

    /**
     * Optional environment variables to override those set in the container definition.
     */
    environment?: Record<string, string>;
}

export abstract class ClusterTaskDefinition extends aws.ecs.TaskDefinition {
    public readonly cluster: module.Cluster2;
    public readonly logGroup: aws.cloudwatch.LogGroup;
    public readonly loadBalancer?: module.ClusterLoadBalancer;
    public readonly containers: Record<string, ContainerDefinition>;

    /**
     * Runs this task definition in this cluster once.
     */
    public readonly run: (options?: TaskRunOptions) => Promise<void>;

    protected abstract isFargate(): boolean;

    constructor(name: string, cluster: module.Cluster2,
                args: ClusterTaskDefinitionArgs,
                opts?: pulumi.ComponentResourceOptions) {

        const logGroup = args.logGroup || new aws.cloudwatch.LogGroup(name, {
            retentionInDays: 1,
        }, opts);

        const taskRole = args.taskRole || createTaskRole(opts);
        const executionRole = args.executionRole || createExecutionRole(opts);

        const containers = args.containers;
        const loadBalancer = createLoadBalancer(
            cluster, singleContainerWithLoadBalancerPort(containers));

        // for (const containerName of Object.keys(containers)) {
        //     const container = containers[containerName];
        //     // if (firstContainerName === undefined) {
        //     //     firstContainerName = containerName;
        //     //     if (container.ports && container.ports.length > 0) {
        //     //         firstContainerPort = container.ports[0].port;
        //     //     }
        //     // }

        //     // ports[containerName] = {};
        //     if (container.loadBalancerPort) {
        //         if (loadBalancer) {
        //             throw new Error("Only one port can currently be exposed per Service.");
        //         }
        //         const loadBalancerPort = container.loadBalancerPort;
        //         loadBalancer = cluster.createLoadBalancer(
        //             name + "-" + containerName, { loadBalancerPort });
        //         ports[containerName][portMapping.port] = {
        //             host: info.loadBalancer,
        //             hostPort: portMapping.port,
        //             hostProtocol: info.protocol,
        //         };
        //         loadBalancers.push({
        //             containerName: containerName,
        //             containerPort: loadBalancerPort.targetPort || loadBalancerPort.port,
        //             targetGroupArn: loadBalancer.targetGroup.arn,
        //         });
        //     }
        // }

        const containerDefinitions = computeContainerDefinitions(name, cluster, args);

        const taskDefArgs: aws.ecs.TaskDefinitionArgs = {
            ...args,
            family: name,
            taskRoleArn: taskRole.arn,
            executionRoleArn: executionRole.arn,
            containerDefinitions: containerDefinitions.apply(JSON.stringify),
        };

    // // Find all referenced Volumes.
    // const volumes: { hostPath?: string; name: string }[] = [];
    // for (const containerName of Object.keys(containers)) {
    //     const container = containers[containerName];

    //     // Collect referenced Volumes.
    //     if (container.volumes) {
    //         for (const volumeMount of container.volumes) {
    //             const volume = volumeMount.sourceVolume;
    //             volumes.push({
    //                 hostPath: (volume as Volume).getHostPath(),
    //                 name: (volume as Volume).getVolumeName(),
    //             });
    //         }
    //     }
    // }

    // // Create the task definition for the group of containers associated with this Service.
    // const containerDefinitions = computeContainerDefinitions(parent, containers, ports, logGroup);

    // // Compute the memory and CPU requirements of the task for Fargate
    // const taskMemoryAndCPU = containerDefinitions.apply(taskMemoryAndCPUForContainers);
        super(name, taskDefArgs, opts);

        this.containers = containers;
        this.cluster = cluster;
        this.logGroup = logGroup;
        this.loadBalancer = loadBalancer;

        const subnetIds = pulumi.all(cluster.network.subnetIds);
        const securityGroupId =  cluster.instanceSecurityGroup.id;

        const containersOutput = pulumi.output(containers);
        const isFargate = this.isFargate();

        this.run = async function (options: TaskRunOptions = {}) {
            const ecs = new aws.sdk.ECS();

            const innerContainers = containersOutput.get();
            const containerName = options.containerName || Object.keys(innerContainers)[0];
            if (!containerName) {
                throw new Error("No valid container name found to run task for.");
            }

            const container = innerContainers[containerName];

            // Extract the environment values from the options
            const env: { name: string, value: string }[] = [];
            addEnvironmentVariables(container.environment);
            addEnvironmentVariables(options && options.environment);

            const assignPublicIp = isFargate && !cluster.network.usePrivateSubnets;

            // Run the task
            const res = await ecs.runTask({
                cluster: cluster.arn.get(),
                taskDefinition: this.arn.get(),
                placementConstraints: placementConstraintsForHost(options && options.os),
                launchType: isFargate ? "FARGATE" : "EC2",
                networkConfiguration: {
                    awsvpcConfiguration: {
                        assignPublicIp: assignPublicIp ? "ENABLED" : "DISABLED",
                        securityGroups: [ securityGroupId.get() ],
                        subnets: subnetIds.get(),
                    },
                },
                overrides: {
                    containerOverrides: [
                        {
                            name: "container",
                            environment: env,
                        },
                    ],
                },
            }).promise();

            if (res.failures && res.failures.length > 0) {
                throw new Error("Failed to start task:" + JSON.stringify(res.failures));
            }

            return;

            // Local functions
            function addEnvironmentVariables(e: Record<string, string> | undefined) {
                if (e) {
                    for (const key of Object.keys(e)) {
                        const envVal = e[key];
                        if (envVal) {
                            env.push({ name: key, value: envVal });
                        }
                    }
                }
            }
        };
    }
}

export function placementConstraintsForHost(os: HostOperatingSystem | undefined) {
    os = os || "linux";

    return [{
        type: "memberOf",
        expression: `attribute:ecs.os-type == ${os}`,
    }];
}

function createLoadBalancer(
        cluster: module.Cluster2,
        info: { containerName: string, container: ContainerDefinition } | undefined) {
    if (!info) {
        return;
    }

    const { containerName, container } = info;
    return  cluster.createLoadBalancer(
        name + "-" + containerName, { loadBalancerPort: container.loadBalancerPort! });
}

export function singleContainerWithLoadBalancerPort(
    containers: Record<string, ContainerDefinition>) {

    let match: { containerName: string, container: ContainerDefinition } | undefined;
    for (const containerName of Object.keys(containers)) {
        const container = containers[containerName];
        const loadBalancerPort = container.loadBalancerPort;
        if (loadBalancerPort) {
            if (match) {
                throw new Error("Only a single container can specify a [loadBalancerPort].");
            }

            match = { containerName, container };
        }
    }

    return match;
}

function computeContainerDefinitions(
    name: string,
    cluster: module.Cluster2,
    args: ClusterTaskDefinitionArgs): pulumi.Output<aws.ecs.ContainerDefinition[]> {

    const result: pulumi.Output<aws.ecs.ContainerDefinition>[] = [];

    for (const containerName of Object.keys(args.containers)) {
        const container = args.containers[containerName];

        result.push(computeContainerDefinition(name, cluster, containerName, container));
    }

    return pulumi.all(result);

    // let loadBalancer: module.ClusterLoadBalancer | undefined = undefined;
    // const containers = args.containers;
    // for (const containerName of Object.keys(containers)) {
    //     const container = containers[containerName];
    //     // if (firstContainerName === undefined) {
    //     //     firstContainerName = containerName;
    //     //     if (container.ports && container.ports.length > 0) {
    //     //         firstContainerPort = container.ports[0].port;
    //     //     }
    //     // }

    //     // ports[containerName] = {};
    //     if (container.loadBalancerPort) {
    //         if (loadBalancer) {
    //             throw new Error("Only one port can currently be exposed per Service.");
    //         }
    //         const loadBalancerPort = container.loadBalancerPort;
    //         loadBalancer = cluster.createLoadBalancer(
    //             name + "-" + containerName, container.loadBalancerPort);
    //         ports[containerName][portMapping.port] = {
    //             host: info.loadBalancer,
    //             hostPort: portMapping.port,
    //             hostProtocol: info.protocol,
    //         };
    //         loadBalancers.push({
    //             containerName: containerName,
    //             containerPort: loadBalancerPort.targetPort || loadBalancerPort.port,
    //             targetGroupArn: loadBalancer.targetGroup.arn,
    //         });
    //     }
    // }
}

function computeContainerDefinition(
    name: string,
    cluster: module.Cluster2,
    containerName: string,
    container: ContainerDefinition): pulumi.Output<aws.ecs.ContainerDefinition> {

    throw new Error("nyi");
}


const defaultComputePolicies = [
    aws.iam.AWSLambdaFullAccess,                 // Provides wide access to "serverless" services (Dynamo, S3, etc.)
    aws.iam.AmazonEC2ContainerServiceFullAccess, // Required for lambda compute to be able to run Tasks
];

// The ECS Task assume role policy for Task Roles
const defaultTaskRolePolicy = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": "sts:AssumeRole",
            "Principal": {
                "Service": "ecs-tasks.amazonaws.com",
            },
            "Effect": "Allow",
            "Sid": "",
        },
    ],
};

function createTaskRole(opts?: pulumi.ResourceOptions): aws.iam.Role {
    const taskRole = new aws.iam.Role("task", {
        assumeRolePolicy: JSON.stringify(defaultTaskRolePolicy),
    }, opts);

    // TODO[pulumi/pulumi-cloud#145]: These permissions are used for both Lambda and ECS compute.
    // We need to audit these permissions and potentially provide ways for users to directly configure these.
    const policies = defaultComputePolicies;
    for (let i = 0; i < policies.length; i++) {
        const policyArn = policies[i];
        const _ = new aws.iam.RolePolicyAttachment(
            `task-${utils.sha1hash(policyArn)}`, {
                role: taskRole,
                policyArn: policyArn,
            }, opts);
    }

    return taskRole;
}

function createExecutionRole(opts?: pulumi.ResourceOptions): aws.iam.Role {
    const executionRole = new aws.iam.Role("execution", {
        assumeRolePolicy: JSON.stringify(defaultTaskRolePolicy),
    }, opts);
    const _ = new aws.iam.RolePolicyAttachment("execution", {
        role: executionRole,
        policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    }, opts);

    return executionRole;
}

export class FargateTaskDefinition extends ClusterTaskDefinition {
    protected isFargate: () => true;

    constructor(name: string, cluster: module.Cluster2,
                args: module.FargateTaskDefinitionArgs,
                opts?: pulumi.ComponentResourceOptions) {

        if (!args.container && !args.containers) {
            throw new Error("Either [container] or [containers] must be provided");
        }

        const containers = args.containers || { container: args.container! };
        const { memory, cpu } = computeFargateMemoryAndCPU(containers);

        const baseArgs: ClusterTaskDefinitionArgs = {
            ...args,
            containers,
            requiresCompatibilities: ["FARGATE"],
            networkMode: "awsvpc",
            memory: args.memory || memory,
            cpu: args.cpu || cpu,
        };

        super(name, cluster, baseArgs, opts);
    }
}

function computeFargateMemoryAndCPU(containers: Record<string, ContainerDefinition>) {
    // Sum the requested memory and CPU for each container in the task.
    let minTaskMemory = 0;
    let minTaskCPU = 0;
    for (const containerName of Object.keys(containers)) {
        const containerDef = containers[containerName];

        if (containerDef.memoryReservation) {
            minTaskMemory += containerDef.memoryReservation;
        } else if (containerDef.memory) {
            minTaskMemory += containerDef.memory;
        }

        if (containerDef.cpu) {
            minTaskCPU += containerDef.cpu;
        }
    }

    // Compute the smallest allowed Fargate memory value compatible with the requested minimum memory.
    let taskMemory: number;
    let taskMemoryString: string;
    if (minTaskMemory <= 512) {
        taskMemory = 512;
        taskMemoryString = "0.5GB";
    } else {
        const taskMemGB = minTaskMemory / 1024;
        const taskMemWholeGB = Math.ceil(taskMemGB);
        taskMemory = taskMemWholeGB * 1024;
        taskMemoryString = `${taskMemWholeGB}GB`;
    }

    // Allowed CPU values are powers of 2 between 256 and 4096.  We just ensure it's a power of 2 that is at least
    // 256. We leave the error case for requiring more CPU than is supported to ECS.
    let taskCPU = Math.pow(2, Math.ceil(Math.log2(Math.max(minTaskCPU, 256))));

    // Make sure we select an allowed CPU value for the specified memory.
    if (taskMemory > 16384) {
        taskCPU = Math.max(taskCPU, 4096);
    } else if (taskMemory > 8192) {
        taskCPU = Math.max(taskCPU, 2048);
    } else if (taskMemory > 4096) {
        taskCPU = Math.max(taskCPU, 1024);
    } else if (taskMemory > 2048) {
        taskCPU = Math.max(taskCPU, 512);
    }

    // Return the computed task memory and CPU values
    return {
        memory: taskMemoryString,
        cpu: `${taskCPU}`,
    };
}
