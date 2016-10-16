'use strict';

var expect = require('expect.js'),
    sinon = require('sinon'),
    Plugin = require('../index.js');

describe('serverless-plugin-external-sns-events', function() {

   describe('init', function() {

      it('registers the appropriate hook', function() {
         var plugin = new Plugin();

         expect(plugin.hooks['deploy:compileEvents']).to.be.a('function');
      });

      it('registers a hook that calls compileEvents', function() {
         var spy = sinon.spy(),
             ExtPlugin = Plugin.extend({ compileEvents: spy }),
             plugin = new ExtPlugin();

         plugin.hooks['deploy:compileEvents']();

         expect(spy.called).to.be.ok();
         expect(spy.calledOn(plugin));
      });

   });


   describe('compileEvents', function() {

      // TODO: write tests

   });


   describe('compileEvent', function() {

      // TODO: write tests

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


   describe('_normalizeTopicARN', function() {
      var plugin = new Plugin();

      it('produces expected output for a string', function() {
         expect(plugin._normalizeTopicARN('arn:aws:sns:us-east-1:1234567890:foo-topic')).to
            .eql('Arnawssnsuseast11234567890footopic');
      });

      it('produces expected output for a Fn::Join object', function() {
         var arn;

         arn = {
            'Fn::Join': [
               'arn:aws:sns:us-east-1:',
               { Ref: 'AWS::AccountId' },
               ':foo-topic',
            ]
         };

         expect(plugin._normalizeTopicARN(arn)).to.eql('Arnawssnsuseast1AWSAccountIdfootopic');
      });

   });

});
