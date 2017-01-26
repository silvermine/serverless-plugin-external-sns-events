'use strict';

var expect = require('expect.js'),
    Plugin = require('../index.js'),
    Q = require('q'),
    sinon = require('sinon');

describe('serverless-plugin-external-sns-events', function() {

   function createMockServerless(requestFunc) {
      var serverless, provider;

      provider = {
         request: requestFunc
      };

      serverless = {
         getProvider: function(providerName) {
            if (providerName !== 'aws') {
               return null;
            }

            return provider;
         },
         service: {
            provider: {
               compiledCloudFormationTemplate: {
                  Resources: {}
               }
            }
         },
         cli: { log: function() {
            return;
         } },
      };
      return serverless;
   }

   function createMockRequest(requestStub) {
      return function() {
         var reqArgs = Array.prototype.slice.call(arguments);

         return Q.promise(function(resolve, reject) {
            var result = requestStub.apply(undefined, reqArgs);

            if (result !== null) {
               resolve(result);
               return;
            }

            reject(new Error('Call to request() with unexpected arguments:  ' + JSON.stringify(reqArgs)));
         });
      };
   }

   function isPromise(obj) {
      return !!obj && (typeof obj === 'object' || typeof obj === 'function') && typeof obj.then === 'function';
   }

   describe('addEventPermission', function() {

      it('can compile lambda permission with correct FunctionName and SourceArn', function() {
         var topicName = 'cool-Topic',
             functionName = 'myFunc',
             mockServerless = createMockServerless(createMockRequest(sinon.stub())),
             spyRequestFunc = sinon.spy(mockServerless.getProvider('aws'), 'request'),
             plugin = new Plugin(mockServerless, {}),
             expPerm, expResourceName, actualPerm;

         plugin.addEventPermission(functionName, { name: functionName }, topicName);

         expect(spyRequestFunc.callCount).to.be(0);
         expect(Object.keys(mockServerless.service.provider.compiledCloudFormationTemplate.Resources).length).to.be(1);

         expResourceName = 'MyFuncLambdaPermissionCoolTopic';

         expect(expResourceName in mockServerless.service.provider.compiledCloudFormationTemplate.Resources).to.be(true);

         actualPerm = mockServerless.service.provider.compiledCloudFormationTemplate.Resources[expResourceName];

         expPerm = {
            Type: 'AWS::Lambda::Permission',
            Properties: {
               FunctionName: { 'Fn::GetAtt': [ 'MyFuncLambdaFunction', 'Arn' ] },
               Action: 'lambda:InvokeFunction',
               Principal: 'sns.amazonaws.com',
               SourceArn: { 'Fn::Join': [ ':', [ 'arn:aws:sns', { 'Ref': 'AWS::Region' }, { 'Ref': 'AWS::AccountId' }, 'cool-Topic' ] ] }
            },
         };

         expect(actualPerm).to.eql(expPerm);
      });

   });

   describe('_getSubscriptionInfo', function() {

      it('can return SNS Subscription info when subscription exists', function() {
         var account = '12349',
             topicName = 'cooltopic',
             functionName = 'myFunc',
             stage = 'test1',
             region = 'us-west-42',
             subscriptionArn = 'arn:aws:sns:correct',
             lambdaArn = 'arn:aws:lambda:' + region + ':' + account + ':function:' + functionName,
             topicArn = 'arn:aws:sns:' + region + ':' + account + ':' + topicName,
             requestStub = sinon.stub(),
             mockServerless, requestMethod, actual, plugin;

         requestStub.withArgs('Lambda', 'getFunction', { FunctionName: functionName }, stage, region)
            .returns({ Configuration: { FunctionArn: lambdaArn } });

         requestStub.withArgs('SNS', 'listSubscriptionsByTopic', { TopicArn: topicArn }, stage, region)
            .returns({
               Subscriptions: [
                  { Protocol: 'other', Endpoint: lambdaArn, SubscriptionArn: 'junk' },
                  { Protocol: 'lambda', Endpoint: lambdaArn, SubscriptionArn: subscriptionArn },
                  { Protocol: 'lambda', Endpoint: 'wronglambda', SubscriptionArn: 'junksub' },
               ]
            });

         mockServerless = createMockServerless(createMockRequest(requestStub));

         requestMethod = sinon.spy(mockServerless.getProvider('aws'), 'request');

         plugin = new Plugin(mockServerless, { stage: stage, region: region });

         actual = plugin._getSubscriptionInfo({ name: functionName }, topicName);

         expect(isPromise(actual)).to.be(true);

         return actual.then(function(result) {
            expect(requestMethod.callCount).to.be(2);
            expect(result).to.eql({
               FunctionArn: lambdaArn,
               TopicArn: topicArn,
               SubscriptionArn: subscriptionArn
            });
         });
      });

      it('can return undefined Subscription info when subscription does NOT exist', function() {
         var account = '12349',
             topicName = 'cooltopic',
             functionName = 'myFunc',
             stage = 'test1',
             region = 'us-west-42',
             lambdaArn = ('arn:aws:lambda:' + region + ':' + account + ':function:' + functionName),
             topicArn = ('arn:aws:sns:' + region + ':' + account + ':' + topicName),
             requestStub = sinon.stub(),
             mockServerless, requestMethod, actual, plugin;

         requestStub.withArgs('Lambda', 'getFunction', { FunctionName: functionName }, stage, region)
            .returns({ Configuration: { FunctionArn: lambdaArn } });

         requestStub.withArgs('SNS', 'listSubscriptionsByTopic', { TopicArn: topicArn }, stage, region)
            .returns({
               Subscriptions: [
                  { Protocol: 'other', Endpoint: lambdaArn, SubscriptionArn: 'junk' },
                  { Protocol: 'lambda', Endpoint: 'wronglambda', SubscriptionArn: 'junksub' },
               ]
            });

         mockServerless = createMockServerless(createMockRequest(requestStub));
         requestMethod = sinon.spy(mockServerless.getProvider('aws'), 'request');
         plugin = new Plugin(mockServerless, { stage: stage, region: region });

         actual = plugin._getSubscriptionInfo({ name: functionName }, topicName);

         expect(isPromise(actual)).to.be(true);

         return actual.then(function(result) {
            expect(requestMethod.callCount).to.be(2);
            expect(result).to.eql({
               FunctionArn: lambdaArn,
               TopicArn: topicArn,
               SubscriptionArn: undefined
            });
         });
      });

   });

   describe('subscribeFunction', function() {

      it('can exit early when noDeploy is true', function() {
         var stage = 'test1',
             region = 'us-west-42',
             topicName = 'cooltopic',
             functionName = 'myFunc',
             requestStub = sinon.stub(),
             mockServerless = createMockServerless(createMockRequest(requestStub)),
             requestMethod = sinon.spy(mockServerless.getProvider('aws'), 'request'),
             plugin = new Plugin(mockServerless, { stage: stage, region: region, noDeploy: true }),
             spyGetSubscriptionInfo = sinon.spy(plugin, '_getSubscriptionInfo'),
             actual = plugin.subscribeFunction(functionName, { name: functionName }, topicName);

         expect(isPromise(actual)).to.be(false);
         expect(actual).to.be(undefined);
         expect(spyGetSubscriptionInfo.callCount).to.be(0);
         expect(requestMethod.callCount).to.be(0);
      });

      it('will not add the subscription if it already exists', function() {
         var stage = 'test1',
             region = 'us-west-42',
             topicName = 'cooltopic',
             functionName = 'myFunc',
             requestStub = sinon.stub(),
             mockServerless = createMockServerless(createMockRequest(requestStub)),
             requestMethod = sinon.spy(mockServerless.getProvider('aws'), 'request'),
             plugin = new Plugin(mockServerless, { stage: stage, region: region, noDeploy: false }),
             funcDef = { name: functionName },
             actual, stubGetSubscriptionInfo;

         stubGetSubscriptionInfo = sinon.stub(plugin, '_getSubscriptionInfo', function() {
            return Q({
               FunctionArn: 'some-func-arn',
               TopicArn: 'some-topic-arn',
               SubscriptionArn: 'subscription-arn-here',
            });
         });

         actual = plugin.subscribeFunction(functionName, funcDef, topicName);
         expect(isPromise(actual)).to.be(true);

         return actual.then(function(result) {
            expect(stubGetSubscriptionInfo.callCount).to.be(1);
            expect(stubGetSubscriptionInfo.calledWithExactly(funcDef, topicName)).to.be(true);

            // Since we mocked getSubscriptionInfo and added a fake SubscriptionArn
            // then no subsequent requests should have been made to the provider.
            expect(requestMethod.callCount).to.be(0);

            expect(result).to.be(undefined);
         });
      });

      it('can add the subscription if it does NOT exist', function() {
         var stage = 'test1',
             region = 'us-west-42',
             topicName = 'cooltopic',
             functionName = 'myFunc',
             requestStub = sinon.stub(),
             mockServerless = createMockServerless(createMockRequest(requestStub)),
             requestMethod = sinon.spy(mockServerless.getProvider('aws'), 'request'),
             plugin = new Plugin(mockServerless, { stage: stage, region: region, noDeploy: false }),
             funcDef = { name: functionName },
             actual, stubGetSubscriptionInfo, expSub;

         stubGetSubscriptionInfo = sinon.stub(plugin, '_getSubscriptionInfo', function() {
            return Q({
               FunctionArn: 'some-func-arn',
               TopicArn: 'some-topic-arn',
               SubscriptionArn: undefined
            });
         });

         actual = plugin.subscribeFunction(functionName, funcDef, topicName);

         expect(isPromise(actual)).to.be(true);

         return actual.then(function(result) {
            expect(stubGetSubscriptionInfo.callCount).to.be(1);
            expect(stubGetSubscriptionInfo.calledWithExactly(funcDef, topicName)).to.be(true);

            // Since we mocked getSubscriptionInfo then we will only expect
            // a single call to request, that is to add the subscription.
            expect(requestMethod.callCount).to.be(1);

            expSub = {
               TopicArn: 'some-topic-arn',
               Protocol: 'lambda',
               Endpoint: 'some-func-arn'
            };

            expect(requestMethod.calledWithExactly('SNS', 'subscribe', expSub, stage, region))
               .to
               .be(true);

            expect(result).to.be(undefined);
         });
      });

   });

   describe('unsubscribeFunction', function() {

      it('will not unsubscribe if subscription does not exist', function() {
         var stage = 'test1',
             region = 'us-west-42',
             topicName = 'cooltopic',
             functionName = 'myFunc',
             requestStub = sinon.stub(),
             mockServerless = createMockServerless(createMockRequest(requestStub)),
             requestMethod = sinon.spy(mockServerless.getProvider('aws'), 'request'),
             plugin = new Plugin(mockServerless, { stage: stage, region: region, noDeploy: false }),
             funcDef = { name: functionName },
             actual, stubGetSubscriptionInfo;

         stubGetSubscriptionInfo = sinon.stub(plugin, '_getSubscriptionInfo', function() {
            return Q({
               FunctionArn: 'some-func-arn',
               TopicArn: 'some-topic-arn',
               SubscriptionArn: undefined
            });
         });

         actual = plugin.unsubscribeFunction(functionName, funcDef, topicName);

         expect(isPromise(actual)).to.be(true);

         return actual.then(function() {
            expect(stubGetSubscriptionInfo.callCount).to.be(1);
            expect(stubGetSubscriptionInfo.calledWithExactly(funcDef, topicName)).to.be(true);

            // Since we mocked getSubscriptionInfo to find no existing
            // subscriptions then we will not expect any direct calls to
            // the request method.
            expect(requestMethod.callCount).to.be(0);
         });
      });

      it('can unsubscribe if subscription exist', function() {
         var stage = 'test1',
             region = 'us-west-42',
             topicName = 'cooltopic',
             functionName = 'myFunc',
             requestStub = sinon.stub(),
             mockServerless = createMockServerless(createMockRequest(requestStub)),
             requestMethod = sinon.spy(mockServerless.getProvider('aws'), 'request'),
             plugin = new Plugin(mockServerless, { stage: stage, region: region, noDeploy: false }),
             funcDef = { name: functionName },
             stubGetSubscriptionInfo, actual, params;

         stubGetSubscriptionInfo = sinon.stub(plugin, '_getSubscriptionInfo', function() {
            return Q({
               FunctionArn: 'some-func-arn',
               TopicArn: 'some-topic-arn',
               SubscriptionArn: 'some-subscription-arn'
            });
         });

         actual = plugin.unsubscribeFunction(functionName, funcDef, topicName);

         expect(isPromise(actual)).to.be(true);

         return actual.then(function() {
            expect(stubGetSubscriptionInfo.callCount).to.be(1);
            expect(stubGetSubscriptionInfo.calledWithExactly(funcDef, topicName)).to.be(true);

            // Since we mocked getSubscriptionInfo we should
            // only have one call to the request (to remove the subscription)
            expect(requestMethod.callCount).to.be(1);

            params = {
               SubscriptionArn: 'some-subscription-arn'
            };

            expect(requestMethod.calledWithExactly('SNS', 'unsubscribe', params, stage, region))
               .to
               .be(true);
         });
      });

   });

   describe('_normalize', function() {
      var plugin = new Plugin();

      it('returns undefined for empty strings', function() {
         expect(plugin._normalize('')).to.be(undefined);
         expect(plugin._normalize(false)).to.be(undefined);
         expect(plugin._normalize()).to.be(undefined);
         expect(plugin._normalize('', true)).to.be(undefined);
         expect(plugin._normalize(false, true)).to.be(undefined);
         expect(plugin._normalize(undefined, true)).to.be(undefined);
      });

      it('only modifies the first letter', function() {
         expect(plugin._normalize('someTHING')).to.eql('SomeTHING');
         expect(plugin._normalize('SomeTHING')).to.eql('SomeTHING');
         expect(plugin._normalize('s')).to.eql('S');
         expect(plugin._normalize('S')).to.eql('S');
      });

   });


   describe('_normalizeTopicName', function() {
      var plugin = new Plugin();

      it('produces expected output for a string', function() {
         expect(plugin._normalizeTopicName('foo-topic')).to
            .eql('Footopic');
      });

   });

});
